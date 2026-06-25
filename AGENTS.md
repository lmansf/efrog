# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Architecture

- Vanilla JS SPA with a hash-based router (`js/router.js`). Pages are plain objects with `render()` / `init()` methods registered in `Router.pages`.
- Adding a page requires: (1) create `js/pages/<name>.js`, (2) add `<script defer>` to `index.html`, (3) register in `Router.pages`, (4) add nav links with `data-page="<name>"` to both `.nav-links` (top) and `.bottom-nav` (bottom).
- Local DuckDB-WASM is used for in-session storage (`js/db.js`). Browser → Supabase writes go directly (anon RLS policies). Browser → server reads use the Flask API (`server.py`, hosted on Render).
- Supabase schema is `"Version_1"`. **No anon SELECT policy** on `observations` — reads must go through the Flask server which uses `SUPABASE_DB_URL` (service role) via `psycopg2`.

## Leaderboard

- The leaderboard page (`js/pages/gemroom.js`, route `#leaderboard`) fetches scores via `supabase.rpc('get_leaderboard')` directly from the browser — no Flask server involved, no Render cold-start delay.
- Formula: `unique_species × total_observations × 10`. Only users with `user_id` and `username` set appear (requires Auth0 sign-in + sync).
- The `get_leaderboard()` Postgres function must be created once in the Supabase SQL editor by running `supabase_leaderboard.sql` (at repo root). It uses `SECURITY DEFINER` to read `observations` (which has no anon SELECT policy) and returns only aggregated scores.
- The Flask `/leaderboard` endpoint in `server.py` remains as a fallback but is no longer used by the frontend.
