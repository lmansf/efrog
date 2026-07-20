# Shipping eFrog to TestFlight

Everything code-side is ready: sources, Xcode project definition (`project.yml`), app icon, Info.plist keys (mic permission, launch screen, export compliance), and versioning. The steps below are the parts that need your Mac, your Apple Developer account, and your Auth0 dashboard. First time through takes ~30–45 minutes; later builds are step 6 + 8 only.

## 0. Prerequisites

- A Mac with **Xcode 15+** (App Store).
- **Apple Developer Program** membership ($99/yr) — required for TestFlight.
- Homebrew (for XcodeGen).

## 1. Generate the Xcode project

```bash
brew install xcodegen
cd ios
xcodegen generate
open eFrog.xcodeproj
```

`project.yml` is the source of truth (the `.xcodeproj` is gitignored — regenerate after adding/removing files). On first open, Xcode resolves the Swift packages (Auth0.swift, supabase-swift, onnxruntime — the ONNX Runtime binary is ~100 MB, so the first resolve takes a few minutes).

The model (`frog_classifier.onnx`) and `labels.json` are referenced from the **repo root** — nothing to copy.

## 2. Signing

Target **eFrog → Signing & Capabilities** → check *Automatically manage signing* → pick your **Team**. Xcode registers the bundle id `com.efrog.ios` for you.

If that bundle id is already taken by another account, change `PRODUCT_BUNDLE_IDENTIFIER` in `project.yml`, re-run `xcodegen generate` — and use the new id in the Auth0 URLs below (the callback scheme is the bundle id).

## 3. Auth0 dashboard (once)

Sign-in on iOS needs the native callback registered. In the Auth0 dashboard → **Applications → your app → Settings**, append to BOTH *Allowed Callback URLs* and *Allowed Logout URLs* (comma-separated with the existing web URLs):

```
com.efrog.ios://dev-rbxcy3tqjhebw7aa.us.auth0.com/ios/com.efrog.ios/callback
```

(Format per Auth0.swift: `{bundleId}://{auth0-domain}/ios/{bundleId}/callback`.)

## 4. Smoke-test on a device

Select your iPhone as the run destination → **⌘R**. Check:

1. Model loads (Analyze tab shows the record button, no error banner).
2. Record 5 s near frog audio (or play a frog call from another device) → Analyze → ranked species with confidence.
3. Import an audio file (M4A/WAV/MP3) → Analyze.
4. Verdict buttons (Agree / Dispute / Not now) → row updates in Supabase `observations`.
5. Collection tab shows the observation with the ☁️ synced check.
6. Leaderboard loads (needs the Supabase project with `get_leaderboard()`).
7. Sign in (About tab) → Auth0 web sheet → name shows; a `user_logins` row lands.

The simulator works for everything except the microphone quality path — use file import there.

## 5. App Store Connect (once)

[appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **My Apps → ⊕ New App**:

- Platform **iOS**, Name **eFrog** (App Store names are globally unique — have a fallback like "eFrog — Frog Call ID"), language, **Bundle ID** `com.efrog.ios` (appears in the dropdown once Xcode registered it in step 2), SKU e.g. `efrog-ios-1`.

## 6. Archive & upload

In Xcode: destination **Any iOS Device (arm64)** → **Product → Archive** → Organizer opens → **Distribute App → TestFlight & App Store → Upload** (accept defaults).

The export-compliance question is answered automatically (`ITSAppUsesNonExemptEncryption = false` is in the Info.plist — the app uses only standard HTTPS).

## 7. TestFlight

App Store Connect → eFrog → **TestFlight** tab. The build appears after processing (5–15 min).

- **Internal Testing** (fastest, no review): create an Internal group, add up to 100 users by their Apple-ID email (they need a role on your team — App Store Connect → Users and Access). They get an email → install via the TestFlight app.
- **External Testing** (up to 10 000 testers / public link): create an External group → fill in *What to Test* + contact info → first build goes through Beta App Review (usually ~a day).

## 8. Every build after the first

1. Bump `CURRENT_PROJECT_VERSION` in `project.yml` (every upload needs a higher build number; bump `MARKETING_VERSION` for user-facing releases).
2. `xcodegen generate` → Archive → Upload. New builds land in the same TestFlight groups automatically (internal testers get them instantly).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Package resolve fails | Network/proxy — retry File → Packages → Resolve Package Versions. |
| "No profiles for com.efrog.ios" | Step 2 — team not selected, or bundle id collision. |
| Sign-in sheet closes with error | Step 3 — callback URL not added (or bundle id changed but URLs not updated). |
| "frog_classifier.onnx not found" at launch | Regenerate the project (`xcodegen generate`) — the model is referenced from the repo root, so run it from a full checkout. |
| Upload rejected: missing icon | Shouldn't happen — the 1024 px AppIcon ships in `Assets.xcassets`. |
| Leaderboard/observations fail | Supabase project not set up yet, or `SupabaseManager.Constants` still points at the old project — see `SUPABASE_SETUP.md`. |
