# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Architecture

- Vanilla JS SPA with a hash-based router (`js/router.js`). Pages are plain objects with `render()` / `init()` methods registered in `Router.pages`.
- Adding a page requires: (1) create `js/pages/<name>.js`, (2) add `<script defer>` to `index.html`, (3) register in `Router.pages`, (4) add nav links with `data-page="<name>"` to both `.nav-links` (top) and `.bottom-nav` (bottom).
- Local DuckDB-WASM is used for in-session storage (`js/db.js`). Browser → Supabase writes go directly (anon RLS policies). Browser → server reads use the Flask API (`server.py`, hosted on Render).
- Supabase schema is `"Version_1"`. **No anon SELECT policy** on `observations` — reads must go through the Flask server which uses `SUPABASE_DB_URL` (service role) via `psycopg2`.

## iOS Auth

- Auth module lives in `ios/eFrog/Auth/`. Three files: `AuthManager.swift` (ObservableObject, public API: `login()`, `logout()`, `getAccessToken()`), `UserProfile.swift` (userId/name/email struct), `Auth0.plist` (domain + clientId).
- `AuthManager` mirrors `js/auth.js`: PKCE web-auth login via `ASWebAuthenticationSession`, silent token refresh via `CredentialsManager`, user-info fetch mapped to `UserProfile` (prefers name → email → sub, same as web).
- Audience is `https://efrog.onrender.com` — matches `AUTH0_AUDIENCE` / `EFROG_API_URL` in `js/config.js`.
- Auth0 credentials (domain + clientId) are identical to the web app's `js/config.js`. The iOS URL scheme is `com.efrog.ios`; callback URL must be added to the Auth0 dashboard alongside the existing web URLs.
- `Auth0.plist` must be added to the Xcode target so it is included in the app bundle — Auth0.swift reads it automatically.

## Leaderboard / Gem Room

- `/leaderboard` (GET, no auth required) is a public aggregate endpoint on the Flask server. Formula: `unique_species × total_observations × 10`. Only users with `user_id` and `username` set appear (requires Auth0 sign-in + sync).
- Page lives at `#leaderboard`, module `GemRoomPage` in `js/pages/gemroom.js`.
