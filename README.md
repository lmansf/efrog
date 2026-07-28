# efrog

Frog call classifier — runs in the browser and on iOS. Upload or record audio and the app identifies the species using a machine-learning model.

## How classification works

By default (`EFROG_LOCAL_INFERENCE = true` in `js/config.js`) the model runs **entirely in the browser** via [onnxruntime-web](https://onnxruntime.ai/docs/tutorials/web/). The app downloads `frog_classifier.onnx` once, decodes your audio with the Web Audio API, computes the mel spectrogram in JS (matched bit-for-bit to the Python preprocessing), and runs inference locally. There's no classification server to deploy, no cold start, and your audio never leaves your device.

The class list comes from `labels.json` (kept in sync with the model by the training notebook).

Before showing a result, the browser checks that the audio it analyzed actually carries usable signal. Clips that are silent, near-silent, or under about a second long get a neutral **No frog call confidently detected** panel instead of a species card, and nothing is added to your history or synced. (Only the first 5 seconds of a clip are analyzed, so a long upload that starts with silence abstains too.)

### Running the browser-only app

Serve the project root with any static server so the model file can be fetched:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

> `file://` won't work for local inference because browsers block `fetch` of the model over that protocol — use a static server (above) or deploy to Vercel.

## Sign-in prompt

On first visit, a dismissible modal invites users to sign in so their observations are saved to their account and accessible across devices. The prompt appears after the boot screen clears and is completely optional — users can dismiss it or click **Continue without signing in**.

The dismissed (or signed-in) state is stored in `localStorage` under the key `efrog_signin_prompt_dismissed`, so the prompt never reappears. The prompt is silently skipped if `AUTH0_DOMAIN` / `AUTH0_CLIENT_ID` are not set in `js/config.js`, or if the user is already authenticated on load.

## Optional: Python API

`server.py` provides the same classifier over HTTP, plus the Auth0 / Databricks endpoints used for sign-in and history sync. Set `EFROG_LOCAL_INFERENCE = false` to route classification through it instead. (The Leaderboard at `#leaderboard` fetches scores directly from Supabase via `get_leaderboard()` RPC — not through this server.)

```bash
pip install -r requirements.txt
python3 server.py   # wait for "Warm-up done — first inference is ready."
```

## iOS app

A SwiftUI native app lives under `ios/`. It uses ONNX Runtime Mobile for on-device frog call classification, Auth0.swift for authentication (mirroring the web flow), and supabase-swift for data sync.

See [`ios/README.md`](ios/README.md) for Auth0 dashboard and Xcode setup.

---

### Custom model path

By default the server looks for `frog_classifier.onnx` in the same directory as `server.py`. To use a model stored elsewhere:

Windows:
```cmd
set EFROG_MODEL_PATH=C:\path\to\your_model.onnx
python server.py
```

Linux / macOS:
```bash
EFROG_MODEL_PATH=/path/to/your_model.onnx python3 server.py
```

---

### Classified species

The class list is embedded in `frog_classifier.onnx` by the
[efrog-training](https://github.com/lmansf/efrog-training) notebook — the server reads it from the
model's metadata at startup, so the served species always match the model. Check the live list at
`GET /health` (the `classes` field).

### Training a new model

Run `EDA-Master.ipynb` in the efrog-training repo, then copy the exported model here:

```bash
cp ../efrog-training/artifacts/frog_classifier.onnx ./frog_classifier.onnx
```

No code changes are needed when the species list changes — labels travel inside the model file.

---

## iOS app

A native SwiftUI app (`ios/`) runs the same classifier on-device using ONNX Runtime Mobile. See **[ios/README.md](ios/README.md)** for setup instructions (Xcode 15+, copy model file, configure signing).
