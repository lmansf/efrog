# Telemetry

First-party product analytics stored in your own Supabase project — no third-party trackers, no cookies. It answers **how** the app is used (feature funnels, errors, performance), **where** (timezone/language/device), and **when** (timestamps on everything), so you can tune the experience with real data.

## How it works

- `js/telemetry.js` (loaded right after `config.js`) exposes `window.Telemetry` and auto-collects sessions, page views, errors, and performance. Feature code emits one-line events (`window.Telemetry?.track('analyze_completed', {...})`).
- Events are **batched** in memory and flushed as a single call to the `public.track()` RPC (defined in `supabase_rebuild.sql`) every 12 s, when 25 events queue up, and via `navigator.sendBeacon` when the tab hides or closes — so closing the app doesn't lose the tail of the session.
- `track()` is `SECURITY DEFINER`: the two tables (`Version_1.telemetry_sessions`, `Version_1.telemetry_events`) are completely inaccessible with the publishable key — no reads, no direct writes. The function caps lengths, skips malformed entries, accepts at most 100 events per call, and dedupes by client-generated event id so retried flushes never double-count.
- Works for anonymous visitors; after Auth0 sign-in the session is enriched with the `user_id` (`Telemetry.identify`), joining telemetry to observations/logins.

## Privacy

- **No PII**: no emails, no names — only the anonymous contact id and (when signed in) the Auth0 subject, same identifiers the data tables already use. "Where" is the IANA timezone + language, **not** GPS or IP geolocation.
- **Honors opt-outs**: telemetry disables itself when the browser sends Do Not Track or Global Privacy Control, and via a kill switch: `localStorage.setItem('efrog_telemetry_optout', '1')` (or `Telemetry.optOut()` / `Telemetry.optIn()` from the console or a future settings UI).
- Failure-silent: telemetry never throws into app code and never blocks a user action.

## Session context (one row per tab-session)

`telemetry_sessions`: ids (session/contact/user), `app` (`web`/`ios`), start/last-seen timestamps, `duration_ms` (wall clock), `engaged_ms` (tab-visible time only), `page_views`, and set-once device context — timezone, language(s), platform/os/browser/device_type, user agent, screen + viewport size, pixel ratio, touch, connection type, referrer, landing page, UTM params, PWA/standalone mode, dark-mode & reduced-motion preferences, hardware concurrency, device memory.

## Event catalog

| Event | Emitted from | Props |
|---|---|---|
| `session_start` | telemetry.js | — |
| `page_view` | telemetry.js (hash router) | `from`, `referrer` |
| `perf_page_load` | telemetry.js | `ttfb_ms`, `dcl_ms`, `load_ms`, `transfer_kb`, `cached` |
| `perf_vitals` | telemetry.js (on first tab-hide) | `lcp_ms`, `cls` |
| `js_error` / `promise_rejection` | telemetry.js (≤10/session) | `message`, `source`, `line` |
| `model_loaded` / `model_load_failed` | classifier.js | `elapsed_ms`, `message` |
| `record_started` / `record_stopped` / `mic_denied` | record.js | `seconds` |
| `file_selected` / `file_rejected` | record.js | `type`, `size_kb` / `reason` |
| `analyze_started` | record.js | `source`, `clip_seconds` |
| `analyze_completed` | record.js | `source`, `elapsed_ms`, `species`, `confidence`, `clip_seconds`, `local` |
| `analyze_failed` | record.js | `source`, `elapsed_ms`, `message`, `local` |
| `obs_verdict` | record.js | `verdict` (`agree`/`dispute`/`skip`), `predicted`, `corrected` |
| `feedback_opened` / `feedback_submitted` / `feedback_failed` | feedback.js | ratings, `has_note`, `has_email`, `make_public` |
| `signed_in` | auth.js | — |
| `leaderboard_loaded` / `leaderboard_failed` | gemroom.js | `rows`, `elapsed_ms`, `message` |

Add a new event anywhere with `window.Telemetry?.track('my_event', { any: 'json' })` — no schema change needed (`props` is free-form JSON).

## iOS

The ingestion contract is client-agnostic: `POST {SUPABASE_URL}/rest/v1/rpc/track` with the `apikey` header (or `?apikey=` query param) and a JSON body of `track()`'s named arguments — `_sid`, `_app: "ios"`, context fields, and `_events: [{id, event, page, props, created_at}]`. When the iOS app is wired for release, add a small `TelemetryManager` that mirrors `js/telemetry.js` (assemble context once, batch events, flush on background/foreground transitions) — no backend changes required.

## Query cookbook (Supabase SQL editor)

Daily active users and sessions:

```sql
select left(started_at, 10) as day,
       count(*)                            as sessions,
       count(distinct contact_id)          as visitors,
       count(distinct user_id)             as signed_in_users
from "Version_1".telemetry_sessions
group by 1 order by 1 desc;
```

**Where** the app is used (timezone ≈ region) and on what:

```sql
select timezone, device_type, browser, count(*) as sessions,
       round(avg(engaged_ms) / 1000)::int as avg_engaged_s
from "Version_1".telemetry_sessions
group by 1, 2, 3 order by sessions desc limit 30;
```

**When** it's used — sessions by the user's local hour (timestamps are UTC; each session's stored timezone localizes it):

```sql
select to_char(timezone(coalesce(timezone, 'UTC'), started_at::timestamptz), 'HH24') as local_hour,
       count(*) as sessions
from "Version_1".telemetry_sessions
where started_at is not null
group by 1 order by 1;
```

The analyze funnel — where people drop off:

```sql
select count(*) filter (where event = 'session_start')     as sessions,
       count(*) filter (where event = 'record_started')    as started_recording,
       count(*) filter (where event = 'file_selected')     as picked_a_file,
       count(*) filter (where event = 'analyze_started')   as analyses_started,
       count(*) filter (where event = 'analyze_completed') as analyses_completed,
       count(*) filter (where event = 'obs_verdict')       as gave_a_verdict
from "Version_1".telemetry_events;
```

Model quality as users see it — dispute rate per predicted species:

```sql
select props::jsonb->>'predicted' as species,
       count(*)                                                   as verdicts,
       round(100.0 * count(*) filter (where props::jsonb->>'verdict' = 'dispute') / count(*), 1) as dispute_pct
from "Version_1".telemetry_events
where event = 'obs_verdict'
group by 1 having count(*) >= 5 order by dispute_pct desc;
```

What's slow (p50/p90 in-browser classification time, by device type):

```sql
select s.device_type,
       percentile_cont(0.5) within group (order by (e.props::jsonb->>'elapsed_ms')::float) as p50_ms,
       percentile_cont(0.9) within group (order by (e.props::jsonb->>'elapsed_ms')::float) as p90_ms,
       count(*) as n
from "Version_1".telemetry_events e
join "Version_1".telemetry_sessions s on s.id = e.session_id
where e.event = 'analyze_completed'
group by 1;
```

What's breaking (top errors this week):

```sql
select props::jsonb->>'message' as error, count(*) as hits,
       count(distinct session_id) as sessions_hit, max(received_at) as last_seen
from "Version_1".telemetry_events
where event in ('js_error', 'promise_rejection', 'analyze_failed', 'model_load_failed')
  and received_at > to_char(timezone('utc', now()) - interval '7 days', 'YYYY-MM-DD')
group by 1 order by hits desc limit 20;
```

Retention — returning visitors by first-seen week:

```sql
with firsts as (
  select contact_id, min(left(started_at, 10)) as first_day
  from "Version_1".telemetry_sessions where contact_id is not null group by 1
)
select to_char(date_trunc('week', f.first_day::date), 'YYYY-MM-DD') as cohort_week,
       count(distinct f.contact_id) as new_visitors,
       count(distinct s.contact_id) filter (
         where s.started_at::date > f.first_day::date + 6) as returned_later
from firsts f
join "Version_1".telemetry_sessions s using (contact_id)
group by 1 order by 1 desc;
```

Acquisition — where sessions come from:

```sql
select coalesce(nullif(utm, ''), referrer, '(direct)') as source, count(*) as sessions
from "Version_1".telemetry_sessions
group by 1 order by sessions desc limit 20;
```
