# efrog

Browser-based frog call classifier. Upload or record audio and the app identifies the species using a machine-learning model.

## How classification works

By default (`EFROG_LOCAL_INFERENCE = true` in `js/config.js`) the model runs **entirely in the browser** via [onnxruntime-web](https://onnxruntime.ai/docs/tutorials/web/). The app downloads `frog_classifier.onnx` once, decodes your audio with the Web Audio API, computes the mel spectrogram in JS (matched bit-for-bit to the Python preprocessing), and runs inference locally. There's no classification server to deploy, no cold start, and your audio never leaves your device.

The class list comes from `labels.json` (kept in sync with the model by the training notebook).

### Running the browser-only app

Serve the project root with any static server so the model file can be fetched:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

> `file://` won't work for local inference because browsers block `fetch` of the model over that protocol — use a static server (above) or deploy to Vercel.

## Optional: Python API

`server.py` provides the same classifier over HTTP, plus the Auth0 / Databricks endpoints used for sign-in and history sync. Set `EFROG_LOCAL_INFERENCE = false` to route classification through it instead.

```bash
pip install -r requirements.txt
python3 server.py   # wait for "Warm-up done — first inference is ready."
```

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
