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

## iOS Data Layer (`ios/eFrog/Data/`)

- **`Observation.swift`** — shared model struct (all Supabase columns + local `audioPath`/`synced` fields). `timestamp` maps to Supabase `created_at` TEXT column (ISO 8601 string). `probabilities` is `[String: Double]?` in memory but encoded as a JSON string for Supabase.
- **`SupabaseManager.swift`** — wraps `supabase-swift` client (add via SPM: `https://github.com/supabase/supabase-swift`). Schema `"Version_1"` specified per-query via `.schema("Version_1")`. `fetchObservations` uses `URLSession` + Auth0 JWT directly (not the Swift client) because Supabase has no anon SELECT policy — a RLS policy like `USING (user_id = auth.jwt()->>'sub')` must be added alongside configuring Supabase to accept Auth0 JWTs.
- **`ObservationStore.swift`** — CoreData stack built programmatically (no `.xcdatamodeld` needed). Entity `ObservationEntity` has 7 fields (id, species, confidence, timestamp, audioPath, synced, userId) — a local-display subset of the full Observation; heavier fields (probabilities, melSpectrogram) only go to Supabase.
- iOS uses Auth0.swift + `CredentialsManager` (tokens in Keychain). Auth0 JWT is passed as `Bearer` to both Flask and Supabase REST — no server-side changes needed for mobile clients.

## Leaderboard / Gem Room

- The leaderboard page (`js/pages/gemroom.js`, route `#leaderboard`) fetches scores via `supabase.rpc('get_leaderboard')` directly from the browser — no Flask server involved, no Render cold-start delay.
- Formula: `unique_species × total_observations × 10`. Only users with `user_id` and `username` set appear (requires Auth0 sign-in + sync).
- The `get_leaderboard()` Postgres function must be created once in the Supabase SQL editor by running `supabase_leaderboard.sql` (at repo root). It uses `SECURITY DEFINER` to read `observations` (which has no anon SELECT policy) and returns only aggregated scores.
- The Flask `/leaderboard` endpoint in `server.py` remains as a fallback but is no longer used by the frontend.

## iOS audio pipeline (`ios/eFrog/Audio/`)

Three Swift files form the audio pipeline.  All target 16 kHz mono Float32, 80 000 samples (5 s).

### MelSpectrogram.swift — parity notes (must match `js/melspectrogram.js`)
- **Periodic Hann**: `w[n] = 0.5 - 0.5 * cos(2π*n / N)` — divisor is `N` (1024), **not** `N-1`.  vDSP's built-in window uses the symmetric form; we compute it by hand.
- **Center padding**: pad 512 zeros on each side before STFT (`nFrames = 1 + len / hop`).
- **Slaney mel scale** (htk=False): linear below 1 kHz (`fSp = 200/3`), log above (`logstep = ln(6.4)/27`).  Exact port from JS.
- **Slaney L1 norm**: `enorm = 2 / (melPts[m+2] - melPts[m])`.
- **power_to_db**: `ref = max(mel)`, `top_db = 80`, `amin = 1e-10`.  Uses `vvlog10f` for vectorised log10.
- **vDSP FFT**: `vDSP_create_fftsetup(10, kFFTRadix2)` + `vDSP_fft_zrip` (log2N=10 for N=1024).  After `vDSP_zvmags`, DC (`realp[0]²`) and Nyquist (`imagp[0]²`) are fixed manually (both have zero mel weight, but we correct them for accuracy).
- **Output shape**: `[[Float]]` with `[nMels=64][nFrames=157]`, values in dB ≈ `[-80, 0]`.

### AudioCapture.swift
- `AVAudioEngine` input tap → `AVAudioConverter` → 16 kHz mono Float32.
- Thread safety: `NSLock` guards the sample accumulation buffer (tap runs on audio thread).
- `stopRecording()` calls `removeTap` **before** `engine.stop()` to prevent in-flight callbacks.

### AudioFileLoader.swift
- `AVAudioFile` + `AVAudioConverter` → 16 kHz mono Float32.
- Reads only as many source frames as needed for 80 000 output samples (avoids large-file allocation).
