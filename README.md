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

| Label | Common name |
|---|---|
| `cane_toad` | Cane Toad |
| `oak_toad` | Oak Toad |
| `southern_toad` | Southern Toad |
