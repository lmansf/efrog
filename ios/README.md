# eFrog iOS

SwiftUI app that runs the frog-call classifier on-device using ONNX Runtime Mobile.

## Requirements

- Xcode 15+
- iOS 16+ target device or simulator
- Mac with an Apple Developer account (free tier works for simulator)

## Setup

### 1. Copy model and labels into Resources

The ONNX model and label file are not checked in (the model is large). Copy them from the repo root:

```sh
cp frog_classifier.onnx ios/eFrog/Resources/frog_classifier.onnx
cp labels.json          ios/eFrog/Resources/labels.json
```

The placeholder files in `ios/eFrog/Resources/` will be overwritten.

### 2. Open in Xcode

Open the `ios/` directory in Xcode:

**File → Open…** → select the `ios/` folder → Xcode auto-detects `Package.swift`

Xcode will resolve SPM dependencies automatically on first open (needs network access). This may take a few minutes — ONNX Runtime Mobile is a large binary dependency.

### 3. Configure signing

1. Select the `eFrog` target in the Project navigator
2. Go to **Signing & Capabilities**
3. Set **Bundle Identifier** to `com.efrog.ios`
4. Choose your **Team** from the dropdown

### 4. Add microphone permission

Add to the target's `Info.plist` (or create one if Xcode hasn't generated it yet):

```xml
<key>NSMicrophoneUsageDescription</key>
<string>eFrog needs the microphone to record frog calls for identification.</string>
```

In Xcode: select the target → **Info** tab → add the key under "Custom iOS Target Properties".

### 5. Build and run

Select a simulator or connected device and press **⌘R**.

## Architecture

| File | Purpose |
|------|---------|
| `App/eFrogApp.swift` | `@main` SwiftUI entry point |
| `App/ContentView.swift` | Root `TabView` (Analyze / Gem Room / About) |
| `Classifier/FrogClassifier.swift` | ORT session wrapper — loads model, runs inference |
| `Classifier/ClassifierResult.swift` | Result value type |
| `Data/Observation.swift` | Shared `Codable` model covering all Supabase columns + local `audioPath`/`synced` fields |
| `Data/SupabaseManager.swift` | Singleton wrapping `supabase-swift`; upserts observations, updates feedback, inserts login events, fetches history |
| `Data/ObservationStore.swift` | CoreData local history store (programmatic model — no `.xcdatamodeld` needed); 7-field subset for display |
| `Resources/frog_classifier.onnx` | ONNX model (copy from repo root) |
| `Resources/labels.json` | Species label list (copy from repo root) |

## Model I/O

| | Shape | Type | Notes |
|-|-------|------|-------|
| Input | `[1, 1, 64, 157]` | Float32 | batch=1, channel=1, mel-bins=64, frames=157 |
| Output | `[1, 19]` | Float32 | Raw logits → sigmoid → per-class probability |

The classifier expects a 64 × T log-mel spectrogram (T ≈ 157 for a 5-second clip at 16 kHz / 512 hop). Sigmoid is applied to each logit inside `FrogClassifier.classify()`.

> **Important:** `frog_classifier.onnx` and `labels.json` must come from the same training run. If the model output class count doesn't match the label count, `classify()` throws `ClassifierError.inferenceFailure` rather than silently returning partial results.

## SPM Dependencies

| Package | Product | Version |
|---------|---------|---------|
| [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) | OrtSwift | ≥ 1.20.0 |
| [auth0/Auth0.swift](https://github.com/auth0/Auth0.swift) | Auth0 | ≥ 2.0.0 |
| [supabase/supabase-swift](https://github.com/supabase/supabase-swift) | Supabase | ≥ 2.0.0 |

> **Note on ORT import:** The ORT Swift package exports its module as `OnnxRuntime`. If Xcode
> reports an import error in `FrogClassifier.swift`, change `import OnnxRuntime` to match
> the module name Xcode resolves from the `OrtSwift` product (check the package graph in
> Xcode → File → Packages → Reset Package Caches if needed).
