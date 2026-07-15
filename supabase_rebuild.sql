-- ─────────────────────────────────────────────────────────────────────────────
-- efrog · FULL Supabase backend rebuild
--
-- Run this ONCE in the SQL editor of a fresh Supabase project and the entire
-- efrog backend is restored: the "Version_1" schema, all four tables
-- (observations, feedback, contacts, user_logins), Row-Level-Security
-- policies, grants, the upsert RPCs the clients call, and get_leaderboard().
--
-- The script is idempotent — re-running it is safe.
--
-- ⚠ One step CANNOT be done in SQL: expose "Version_1" to the Data API.
--   Dashboard → Project Settings → Data API → "Exposed schemas" → add Version_1.
--   Without it every browser/iOS request fails with "The schema must be one of
--   the following: public". See SUPABASE_SETUP.md for the full checklist.
--
-- Design (mirrors js/db.js, js/auth.js, js/feedback.js, server.py, ios/…/Data):
--   • Append-only writes (feedback, user_logins) go browser/iOS-direct with the
--     publishable (anon) key under plain INSERT RLS policies.
--   • Upserted rows (observations, contacts) go through SECURITY DEFINER RPCs
--     (upsert_observation, upsert_contact) instead of direct table access.
--     Why: Postgres applies SELECT policies and SELECT column privileges to
--     INSERT … ON CONFLICT DO UPDATE (the EXCLUDED.* reads), so a PostgREST
--     upsert cannot work against a table anon is not allowed to read. The RPCs
--     keep the tables fully private to anon — no read, no update-arbitrary-row.
--   • There is NO anon SELECT policy on any table: raw rows are not readable
--     with the publishable key. Reads go through the Flask server
--     (SUPABASE_DB_URL, postgres role) or the SECURITY DEFINER leaderboard fn.
--   • All timestamps are TEXT columns holding ISO-8601 strings (project-wide
--     convention, avoids Arrow/BigInt issues in DuckDB-WASM).
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 0. Schema ────────────────────────────────────────────────────────────────
create schema if not exists "Version_1";


-- ── 1. observations ──────────────────────────────────────────────────────────
-- One row per analysis. Written by the browser at analysis time
-- (js/pages/record.js → DB.sendObservation → rpc upsert_observation) and
-- re-upserted with the user's verdict (DB.updateObservationFeedback). The
-- Flask /sync endpoint also inserts rows for signed-in history sync.
create table if not exists "Version_1".observations (
  id            text primary key,
  user_id       text,
  contact_id    text,
  username      text,
  created_at    text,
  type          text,
  name          text,
  duration      double precision,
  species       text,
  confidence    double precision,
  probabilities text,
  is_holo       boolean default false
);

-- Column guards — upgrade a table that predates these columns (no-ops on a
-- fresh project):
--   mel_spectrogram   – base64 little-endian float32, shape [64,157] row-major;
--                       the model input, used by the RL post-training pipeline.
--   included_feedback – true once the user gives a verdict (agree or dispute).
--   feedback          – true = agreed (model right), false = disputed (model
--                       wrong), null = no verdict yet. Nullable on purpose.
--   species_name      – the user-confirmed / corrected species (training label).
alter table "Version_1".observations add column if not exists contact_id        text;
alter table "Version_1".observations add column if not exists is_holo           boolean default false;
alter table "Version_1".observations add column if not exists mel_spectrogram   text;
alter table "Version_1".observations add column if not exists included_feedback boolean default false;
alter table "Version_1".observations add column if not exists feedback          boolean;
alter table "Version_1".observations add column if not exists species_name      text;


-- ── 2. feedback ──────────────────────────────────────────────────────────────
-- The open-ended "Give Feedback" form (js/feedback.js), written browser-direct.
-- email exists only here (the Flask /sync insert path omits it — that's fine,
-- unlisted columns just stay null).
create table if not exists "Version_1".feedback (
  id              text primary key,
  user_id         text,
  contact_id      text,
  observation_id  text,
  created_at      text,
  name            text,
  email           text,
  accuracy_rating integer,
  site_rating     integer,
  frogwatch       text,
  note            text,
  species         text,
  confidence      double precision,
  user_agent      text,
  make_public     boolean default false
);
alter table "Version_1".feedback add column if not exists email       text;
alter table "Version_1".feedback add column if not exists make_public boolean default false;


-- ── 3. contacts ──────────────────────────────────────────────────────────────
-- One row per browser install, keyed by the stable localStorage UUID
-- (efrog_contact_id). Created empty on first visit (DB.getContactId), then
-- enriched via upsert_contact when the visitor leaves an email (feedback form)
-- or signs in (js/auth.js attaches email/username/user_id).
create table if not exists "Version_1".contacts (
  id         text primary key,
  email      text,
  username   text,
  user_id    text,
  updated_at text
);
alter table "Version_1".contacts add column if not exists user_id text;


-- ── 4. user_logins ───────────────────────────────────────────────────────────
-- One row per Auth0 sign-in, for analytics. Web (js/auth.js) sends the full
-- row including id + logged_in_at; iOS (SupabaseManager.sendLoginEvent) sends
-- only user_id/username/created_at — hence the id default and both timestamp
-- columns.
create table if not exists "Version_1".user_logins (
  id             text primary key default gen_random_uuid()::text,
  contact_id     text,
  user_id        text,
  email          text,
  username       text,
  email_verified boolean default false,
  picture        text,
  logged_in_at   text,
  created_at     text,
  user_agent     text
);
alter table "Version_1".user_logins add column if not exists created_at text;


-- ── 5. Row-Level Security ────────────────────────────────────────────────────
-- Everything is default-deny once RLS is on. Only the append-only tables get
-- anon policies (plain INSERT). observations and contacts get NO anon policies
-- at all — their writes go through the SECURITY DEFINER RPCs below, and their
-- reads through the Flask server (postgres role, bypasses RLS as table owner).
alter table "Version_1".observations enable row level security;
alter table "Version_1".feedback     enable row level security;
alter table "Version_1".contacts     enable row level security;
alter table "Version_1".user_logins  enable row level security;

-- feedback: anonymous insert (append-only)
drop policy if exists "anon insert feedback" on "Version_1".feedback;
create policy "anon insert feedback"
  on "Version_1".feedback for insert to anon
  with check (true);

-- user_logins: anonymous insert (append-only)
drop policy if exists "anon insert user_logins" on "Version_1".user_logins;
create policy "anon insert user_logins"
  on "Version_1".user_logins for insert to anon
  with check (true);

-- Clean up direct-write policies from the pre-RPC design, if present
drop policy if exists "anon insert observations" on "Version_1".observations;
drop policy if exists "anon update observations" on "Version_1".observations;
drop policy if exists "anon insert contacts"     on "Version_1".contacts;
drop policy if exists "anon update contacts"     on "Version_1".contacts;


-- ── 6. Upsert RPCs ───────────────────────────────────────────────────────────
-- SECURITY DEFINER: they run as the function owner (postgres, the table owner)
-- so RLS/privileges on the tables don't apply inside. Anon can call them but
-- can only do what they encode: merge one row by id. Merge semantics: a NULL
-- (or omitted) argument leaves the existing value untouched; non-NULL values
-- overwrite. This mirrors how the clients use PostgREST upserts today —
-- sendObservation sends the full row, updateObservationFeedback only the
-- verdict columns, and the contact bootstrap only {id, updated_at}.

create or replace function "Version_1".upsert_observation(
  _id                text,
  _user_id           text             default null,
  _contact_id        text             default null,
  _username          text             default null,
  _created_at        text             default null,
  _type              text             default null,
  _name              text             default null,
  _duration          double precision default null,
  _species           text             default null,
  _confidence        double precision default null,
  _probabilities     text             default null,
  _is_holo           boolean          default null,
  _mel_spectrogram   text             default null,
  _included_feedback boolean          default null,
  _feedback          boolean          default null,
  _species_name      text             default null
)
returns void
language sql
security definer
set search_path = "Version_1", public
as $$
  insert into observations
    (id, user_id, contact_id, username, created_at, type, name, duration,
     species, confidence, probabilities, is_holo, mel_spectrogram,
     included_feedback, feedback, species_name)
  values
    (_id, _user_id, _contact_id, _username, _created_at, _type, _name, _duration,
     _species, _confidence, _probabilities, coalesce(_is_holo, false),
     _mel_spectrogram, coalesce(_included_feedback, false), _feedback, _species_name)
  on conflict (id) do update set
    user_id           = coalesce(excluded.user_id,           observations.user_id),
    contact_id        = coalesce(excluded.contact_id,        observations.contact_id),
    username          = coalesce(excluded.username,          observations.username),
    created_at        = coalesce(excluded.created_at,        observations.created_at),
    type              = coalesce(excluded.type,              observations.type),
    name              = coalesce(excluded.name,              observations.name),
    duration          = coalesce(excluded.duration,          observations.duration),
    species           = coalesce(excluded.species,           observations.species),
    confidence        = coalesce(excluded.confidence,        observations.confidence),
    probabilities     = coalesce(excluded.probabilities,     observations.probabilities),
    is_holo           = coalesce(_is_holo,                   observations.is_holo),
    mel_spectrogram   = coalesce(excluded.mel_spectrogram,   observations.mel_spectrogram),
    included_feedback = coalesce(_included_feedback,         observations.included_feedback),
    feedback          = coalesce(excluded.feedback,          observations.feedback),
    species_name      = coalesce(excluded.species_name,      observations.species_name);
$$;

create or replace function "Version_1".upsert_contact(
  _id         text,
  _email      text default null,
  _username   text default null,
  _user_id    text default null,
  _updated_at text default null
)
returns void
language sql
security definer
set search_path = "Version_1", public
as $$
  insert into contacts (id, email, username, user_id, updated_at)
  values (_id, _email, _username, _user_id, _updated_at)
  on conflict (id) do update set
    email      = coalesce(excluded.email,      contacts.email),
    username   = coalesce(excluded.username,   contacts.username),
    user_id    = coalesce(excluded.user_id,    contacts.user_id),
    updated_at = coalesce(excluded.updated_at, contacts.updated_at);
$$;

revoke all on function "Version_1".upsert_observation(text, text, text, text, text, text, text, double precision, text, double precision, text, boolean, text, boolean, boolean, text) from public;
revoke all on function "Version_1".upsert_contact(text, text, text, text, text) from public;
grant execute on function "Version_1".upsert_observation(text, text, text, text, text, text, text, double precision, text, double precision, text, boolean, text, boolean, boolean, text) to anon, authenticated, service_role;
grant execute on function "Version_1".upsert_contact(text, text, text, text, text) to anon, authenticated, service_role;


-- ── 7. Grants ────────────────────────────────────────────────────────────────
-- anon gets INSERT only on the append-only tables and NOTHING on observations/
-- contacts (all access via the RPCs above). service_role gets full access
-- (bypasses RLS by design). The Flask server connects as the postgres role
-- (SUPABASE_DB_URL), which owns these tables, so it needs no extra grants.
grant usage on schema "Version_1" to anon, authenticated, service_role;

revoke all on "Version_1".observations from anon;
revoke all on "Version_1".contacts     from anon;
grant insert on "Version_1".feedback    to anon;
grant insert on "Version_1".user_logins to anon;

grant all on all tables in schema "Version_1" to service_role;


-- ── 8. Leaderboard function ──────────────────────────────────────────────────
-- Called by the browser via supabase.rpc('get_leaderboard') with the DEFAULT
-- (public) schema client — js/pages/gemroom.js — so it must live in public.
-- SECURITY DEFINER lets it read observations (which anon cannot) while only
-- returning aggregated scores. gem_score = unique_species × total_obs × 10.
create or replace function public.get_leaderboard()
returns table (
  username        text,
  unique_species  bigint,
  total_obs       bigint,
  gem_score       bigint
)
language sql
security definer
set search_path = "Version_1", public
as $$
  select
    (
      select o2.username
      from   observations o2
      where  o2.user_id = o.user_id
        and  o2.username is not null
        and  o2.username != ''
      order  by o2.created_at desc
      limit  1
    )                          as username,
    count(distinct o.species)  as unique_species,
    count(*)                   as total_obs,
    count(distinct o.species) * count(*) * 10  as gem_score
  from  observations o
  where o.user_id is not null
    and o.user_id != ''
  group by o.user_id
  having count(distinct o.species) * count(*) * 10 > 0
  order by gem_score desc
  limit 100;
$$;

grant execute on function public.get_leaderboard() to anon, authenticated;


-- ── 9. OPTIONAL — direct iOS reads (leave commented until wanted) ────────────
-- ios/…/SupabaseManager.fetchObservations calls Supabase REST with the Auth0
-- JWT as Bearer. For that to work you must FIRST register Auth0 as a
-- third-party auth provider (Dashboard → Authentication → Sign In / Up →
-- Third-party auth → Auth0, domain dev-rbxcy3tqjhebw7aa.us.auth0.com) so
-- Supabase maps Auth0 JWTs to the authenticated role — then uncomment:
--
-- drop policy if exists "own observations" on "Version_1".observations;
-- create policy "own observations"
--   on "Version_1".observations for select to authenticated
--   using (user_id = (auth.jwt() ->> 'sub'));
-- grant select on "Version_1".observations to authenticated;
--
-- Until then, iOS/web signed-in reads go through the Flask /observations
-- endpoint, which validates the Auth0 token server-side. Nothing to do.


-- ── Quick checks ─────────────────────────────────────────────────────────────
--   select count(*) from "Version_1".observations;
--   select species, count(*) from "Version_1".observations group by 1 order by 2 desc;
--   select count(*) from "Version_1".observations where included_feedback;
--   select * from public.get_leaderboard();
--   select tablename, policyname from pg_policies where schemaname = 'Version_1';
