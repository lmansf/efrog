# efrog

Frog call classifier — runs in the browser and on iOS. Upload or record audio and the app identifies the species using a machine-learning model.

## How classification works

By default (`EFROG_LOCAL_INFERENCE = true` in `js/config.js`) the model runs **entirely in the browser** via [onnxruntime-web](https://onnxruntime.ai/docs/tutorials/web/). The app downloads `frog_classifier.onnx` once, decodes your audio with the Web Audio API, computes the mel spectrogram in JS (matched bit-for-bit to the Python preprocessing), and runs inference locally. There's no classification server to deploy, no cold start, and your audio never leaves your device.

The class list comes from `labels.json` (kept in sync with the model by the training notebook).

### Running the browser-only app

Serve the project root with any static server so the model file can be fetched:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

> `file://` won't work for local inference because browsers block `fetch` of the model over that protocol — use a static server (above) or deploy to Vercel.

## Crew Workflow

Non-trivial changes in `efrog` follow the captain's loop:

1. **OpenSpec first**: create or update a change in `openspec/changes/` before implementation. Use `openspec new change <name> --description "<summary>"` or the generated Codex command `/opsx:propose "<idea>"`. Keep the proposal, design, specs, and task list with that change until the work is complete, then archive it with `openspec archive <name>` so `openspec/specs/` stays current.
2. **Review through `lavish-axi`**: for browser UI work (`index.html`, `styles.css`, `js/pages/`), iOS UI work (`ios/eFrog/App/`), or any plan/results that are easier to review visually, build an HTML artifact under `.lavish/` and open it with `lavish-axi .lavish/<artifact>.html`. Use `lavish-axi export` or `lavish-axi share` when the review needs a portable or hosted copy.
3. **Validate with `no-mistakes`**: from a top-level session (never from an agent already running as a step inside an active gate), run `no-mistakes doctor`, then `no-mistakes status` in the current worktree. If the worktree reports `repo not initialized`, run `no-mistakes init` there before starting the gate. When the branch is ready, run `no-mistakes axi run` and respond to its gate flow instead of bypassing it.
4. **Repeat as needed**: update the active OpenSpec change, regenerate the `lavish-axi` review surface, and rerun `no-mistakes` until the change is ready to ship.

`.lavish/` is reserved for local generated review artifacts and is ignored by git. When a task explicitly asks for a checked-in artifact, force it past the ignore rule with `git add -f .lavish/<artifact>.html`.

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

See [`ios/README.md`](ios/README.md) for setup instructions (Xcode 15+, copy the model file, configure signing, Auth0 dashboard).

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
