# eFrog iOS

SwiftUI app that runs the frog-call classifier on-device using ONNX Runtime Mobile, mirroring the web app: record/import → identify → verdict, local collection, gem-score leaderboard, Auth0 sign-in, Supabase sync.

## Requirements

- Xcode 15+
- iOS 16+ device or simulator
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)
- Apple Developer account (free tier works for simulator/device runs; the paid program is needed for TestFlight — see [`TESTFLIGHT.md`](TESTFLIGHT.md))

## Setup

```bash
brew install xcodegen
cd ios
xcodegen generate
open eFrog.xcodeproj
```

That's the whole setup:

- **`project.yml` is the source of truth** — the generated `eFrog.xcodeproj` and `eFrog/Info.plist` are gitignored. Re-run `xcodegen generate` after adding/removing files or changing build settings.
- The model and labels are **referenced from the repo root** (`../frog_classifier.onnx`, `../labels.json`) — nothing to copy, the app can never drift from the web app's model.
- Info.plist (mic permission, launch screen, Auth0 URL scheme, export compliance) is generated from the `info:` block in `project.yml`.
- SPM dependencies resolve automatically on first open (ONNX Runtime is a large binary download; a few minutes).
- Signing: select the `eFrog` target → **Signing & Capabilities** → pick your Team.

To put it on TestFlight, follow [`TESTFLIGHT.md`](TESTFLIGHT.md).

## Architecture

| File | Purpose |
|------|---------|
| `project.yml` | XcodeGen project definition (target, Info.plist, SPM packages, bundle id, versions) |
| `App/eFrogApp.swift` | `@main` SwiftUI entry point |
| `App/ContentView.swift` | Root `TabView` (Analyze / Collection / Leaderboard / About) |
| `App/AnalyzeView.swift` | Record 5 s or import file → mel → classify → results + agree/dispute verdict; saves locally + upserts to Supabase |
| `App/CollectionView.swift` | Local observation history (CoreData) with sync badges |
| `App/LeaderboardView.swift` | Gem-score leaderboard via `public.get_leaderboard()` RPC |
| `App/AboutView.swift` | App info + Auth0 sign-in/out (sends login event + contact enrichment) |
| `Audio/AudioCapture.swift` | Microphone capture → 16 kHz mono Float32 (80 000 samples) |
| `Audio/AudioFileLoader.swift` | File loader → 16 kHz mono Float32 (80 000 samples) |
| `Audio/MelSpectrogram.swift` | vDSP log-mel spectrogram matching `js/melspectrogram.js` |
| `Classifier/FrogClassifier.swift` | ORT session wrapper — loads model, runs inference |
| `Classifier/ClassifierResult.swift` | Result value type |
| `Data/Observation.swift` | Shared `Codable` model covering all Supabase columns + local `audioPath`/`synced` fields |
| `Data/SupabaseManager.swift` | Singleton wrapping `supabase-swift`; observation/contact upsert RPCs, feedback verdicts, login events, leaderboard |
| `Data/ObservationStore.swift` | CoreData local history store (programmatic model — no `.xcdatamodeld` needed) |
| `Auth/AuthManager.swift` | Auth0 PKCE web-auth + Keychain credentials (mirrors `js/auth.js`) |

## Model I/O

| | Shape | Type | Notes |
|-|-------|------|-------|
| Input | `[1, 1, 64, 157]` | Float32 | batch=1, channel=1, mel-bins=64, frames=157 |
| Output | `[1, 19]` | Float32 | Raw logits → sigmoid → per-class probability |

The classifier expects a 64 × T log-mel spectrogram (T ≈ 157 for a 5-second clip at 16 kHz / 512 hop). `MelSpectrogram.swift` produces this from the 80 000-sample PCM buffers returned by `AudioCapture` or `AudioFileLoader`. Sigmoid is applied to each logit inside `FrogClassifier.classify()`.

> **Important:** `frog_classifier.onnx` and `labels.json` must come from the same training run. If the model output class count doesn't match the label count, `classify()` throws `ClassifierError.inferenceFailure` rather than silently returning partial results.

## SPM Dependencies (declared in `project.yml`)

| Package | Product | Import | Version |
|---------|---------|--------|---------|
| [microsoft/onnxruntime-swift-package-manager](https://github.com/microsoft/onnxruntime-swift-package-manager) | `onnxruntime` | `OnnxRuntimeBindings` | ≥ 1.24.2 |
| [auth0/Auth0.swift](https://github.com/auth0/Auth0.swift) | `Auth0` | `Auth0` | ≥ 2.5.0 |
| [supabase/supabase-swift](https://github.com/supabase/supabase-swift) | `Supabase` | `Supabase` | ≥ 2.5.0 |
