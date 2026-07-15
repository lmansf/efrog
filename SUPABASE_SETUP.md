# Rebuilding the Supabase backend on a new project

Everything the app needs from Supabase is restored by one script — **`supabase_rebuild.sql`** — plus a handful of dashboard/config steps listed below. Total time: ~15 minutes.

## Who talks to Supabase, and how

| Client | Path | Credential | What it does |
|---|---|---|---|
| Browser (`js/db.js`, `js/feedback.js`, `js/auth.js`) | PostgREST, schema `Version_1` | URL + publishable (anon) key in `js/config.js` | Inserts feedback + user_logins; merges observations + contacts via the `upsert_observation` / `upsert_contact` RPCs |
| Browser leaderboard (`js/pages/gemroom.js`) | `rpc('get_leaderboard')`, schema `public` | same | Reads aggregated scores only |
| Flask server on Render (`server.py`) | Direct Postgres via `psycopg2` | `SUPABASE_DB_URL` env var (postgres role) | `/sync`, `/observations`, `/leaderboard` fallback, `/contact` |
| iOS (`ios/eFrog/Data/SupabaseManager.swift`) | supabase-swift + PostgREST, schema `Version_1` | URL + key hardcoded in `Constants` | Same writes as the browser |

Auth0 is **not** connected to Supabase — tokens are only verified by the Flask server. Rebuilding Supabase requires **no Auth0 changes**.

> **Why RPCs for observations/contacts?** These two tables are merged by id
> (a feedback verdict or an email attaches to a row written earlier). Postgres
> applies SELECT policies and SELECT column privileges to
> `INSERT … ON CONFLICT DO UPDATE`, so a PostgREST upsert can only work on a
> table the anon key is allowed to read — which would have made observation
> spectrograms and contact emails publicly readable. The `SECURITY DEFINER`
> RPCs in `supabase_rebuild.sql` do the merge server-side instead, so both
> tables stay completely unreadable (and un-overwritable) with the publishable
> key. The matching client code is already in `js/db.js` and
> `SupabaseManager.swift` on this branch — deploy the web app and rebuild the
> iOS app from it (you're doing both anyway for the new credentials).

## Step 1 — Create the project

Create a new Supabase project (any name/region). Wait for it to finish provisioning.

## Step 2 — Run the rebuild script

SQL Editor → New query → paste the whole of `supabase_rebuild.sql` → Run.

This creates the `Version_1` schema, the four tables (`observations`, `feedback`, `contacts`, `user_logins`), all RLS policies and grants, the `upsert_observation` / `upsert_contact` RPCs, and the `public.get_leaderboard()` function. It's idempotent — re-run it freely. (The former `supabase_observations.sql` and `supabase_leaderboard.sql` scripts were folded into it and removed.)

## Step 3 — Expose the `Version_1` schema (dashboard-only, easy to miss)

Project Settings → **Data API** → **Exposed schemas** → add `Version_1` (keep `public`).

Without this, every browser/iOS write fails with *"The schema must be one of the following: public"*. This setting cannot be done in SQL, which is why it's not in the script.

## Step 4 — Update the web app credentials

Project Settings → **API Keys**: copy the **Project URL** and the **publishable** key (`sb_publishable_…`; a legacy `anon` JWT works too).

Edit `js/config.js:24-25`:

```js
const SUPABASE_URL      = 'https://<new-project-ref>.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_…';
```

That one edit covers all browser paths (writes **and** the leaderboard). Redeploy the static site (Vercel).

## Step 5 — Update the iOS app credentials

Edit `ios/eFrog/Data/SupabaseManager.swift:26-27` (the `Constants` enum) with the same URL + key, then rebuild the app.

## Step 6 — Update the Render server connection string

Project Settings (Supabase) → **Database** → Connection string → copy the **pooler** URI, e.g.

```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

Render dashboard → `efrog-api` service → Environment → set `SUPABASE_DB_URL` to it (it's declared `sync: false` in `render.yaml`, so it's set only in the dashboard). Redeploy/restart the service.

## Step 7 — Verify

1. **Anonymous write path**: open the site in a private window, run an analysis → `select count(*) from "Version_1".observations;` should tick up; the `contacts` table should gain a row.
2. **Feedback**: submit the Feedback form → row in `Version_1.feedback`.
3. **Leaderboard**: visit `#leaderboard` — empty is fine on a fresh DB; an error banner means Step 3 or 4 went wrong.
4. **Signed-in path**: sign in → a `user_logins` row appears and `/sync` on Render returns 200 (checks `SUPABASE_DB_URL`).

## Optional — migrate data from the old project

If the old project (`dhnzjpgrcuwbptzjlkec`) still exists, copy the rows with `pg_dump`:

```bash
pg_dump  "$OLD_SUPABASE_DB_URL" --schema '"Version_1"' --data-only > efrog_data.sql
psql     "$NEW_SUPABASE_DB_URL" -f efrog_data.sql
```

(Or per-table CSV export/import from the dashboard Table Editor.) If the old project is gone, skip — the schema starts empty.

## Optional — direct iOS reads

`SupabaseManager.fetchObservations` (iOS reading history straight from Supabase with the Auth0 JWT) needs Auth0 registered as a third-party auth provider **plus** the commented-out SELECT policy at the bottom of `supabase_rebuild.sql`. This was never enabled on the old project; signed-in reads currently go through the Flask `/observations` endpoint, which keeps working with no action.

## What does NOT need to change

- **Auth0** (domain, client ID, audience, callback URLs) — independent of Supabase.
- **`EFROG_API_URL`** / Render service URL, `server.py`, model files, Vercel hosting.
- **Table names, schema name, and column shapes** — identical to the old project, so old data imports cleanly and the Flask server queries are untouched.
