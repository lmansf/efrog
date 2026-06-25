# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Architecture

- Vanilla JS SPA with a hash-based router (`js/router.js`). Pages are plain objects with `render()` / `init()` methods registered in `Router.pages`.
- Adding a page requires: (1) create `js/pages/<name>.js`, (2) add `<script defer>` to `index.html`, (3) register in `Router.pages`, (4) add nav links with `data-page="<name>"` to both `.nav-links` (top) and `.bottom-nav` (bottom).
- Local DuckDB-WASM is used for in-session storage (`js/db.js`). Browser → Supabase writes go directly (anon RLS policies). Browser → server reads use the Flask API (`server.py`, hosted on Render).
- Supabase schema is `"Version_1"`. **No anon SELECT policy** on `observations` — reads must go through the Flask server which uses `SUPABASE_DB_URL` (service role) via `psycopg2`.

## Leaderboard / Gem Room

- `/leaderboard` (GET, no auth required) is a public aggregate endpoint on the Flask server. Formula: `unique_species × total_observations × 10`. Only users with `user_id` and `username` set appear (requires Auth0 sign-in + sync).
- Page lives at `#gemroom`, module `GemRoomPage` in `js/pages/gemroom.js`.

## iOS App (`ios/`)

- Swift Package (`ios/Package.swift`) targeting iOS 16+; open the `ios/` directory in Xcode (auto-detects SPM).
- Three SPM dependencies: ONNX Runtime (`OrtSwift` product, ≥ 1.20.0), Auth0.swift (≥ 2.0), supabase-swift (≥ 2.0).
- Model I/O: input `[1, 1, 64, 157]` Float32 (batch, channel, mel-bins=64, frames=157); output `[1, 19]` raw logits. Sigmoid applied in `FrogClassifier.swift`.
- `FrogClassifier.swift` uses the ORT ObjC/Swift API: `ORTEnv`, `ORTSession`, `ORTValue`. Import is `import OnnxRuntime`; adjust if Xcode resolves the `OrtSwift` product under a different module name.
- Resource files `frog_classifier.onnx` and `labels.json` must be copied from repo root into `ios/eFrog/Resources/` before building (they are gitignored / placeholder in the repo). See `ios/README.md`.
