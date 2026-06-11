# efrog

Browser-based frog call classifier. Upload or record audio and the app identifies the species using a local ML model.

## Requirements

- Python 3.9+
- A modern browser (Chrome, Firefox, Edge)
- `frog_classifier.onnx` — place it in the project root

## Setup

```bash
pip install -r requirements.txt
```

> On Linux you may need `pip3` instead of `pip`.

## Running

**1. Start the API server**

Windows:
```cmd
python server.py
```

Linux / macOS:
```bash
python3 server.py
```

Wait for `Warm-up done — first inference is ready.` before using the app.

**2. Open the app**

Open `index.html` directly in your browser (no web server needed — `file://` works).

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
