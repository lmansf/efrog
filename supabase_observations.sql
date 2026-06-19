-- ─────────────────────────────────────────────────────────────────────────────
-- efrog · Supabase setup for browser-direct OBSERVATIONS recording
-- Run this in the Supabase SQL editor (schema: Version_1).
--
-- Writes are browser-direct from every visitor (anonymous + logged-in), mirroring
-- the feedback/contacts flow. Reads stay server-side (the Flask /observations
-- endpoint validates the Auth0 token and uses the service connection), so there
-- is intentionally NO anon SELECT policy here — observations are not publicly
-- readable with the publishable key.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Table (no-op if it already exists)
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

-- 2. Add the newer columns if the table predates them
alter table "Version_1".observations add column if not exists contact_id text;
alter table "Version_1".observations add column if not exists is_holo    boolean default false;

-- 3. Row-Level Security: allow anonymous INSERTs (append-only), like feedback.
--    No SELECT/UPDATE/DELETE policy for anon → the publishable key can write but
--    cannot read or modify rows. Reads go through the server.
alter table "Version_1".observations enable row level security;

drop policy if exists "anon insert observations" on "Version_1".observations;
create policy "anon insert observations"
  on "Version_1".observations
  for insert
  to anon
  with check (true);

-- 4. Grants for the anon (publishable) role
grant usage  on schema "Version_1" to anon;
grant insert on "Version_1".observations to anon;

-- Quick checks:
--   select count(*) from "Version_1".observations;                 -- total recorded
--   select species, count(*) from "Version_1".observations group by 1 order by 2 desc;
--   select count(*) from "Version_1".observations where is_holo;   -- holo count (~5%)
