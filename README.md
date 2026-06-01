# efrog

Browser-based frog call classifier. Upload or record audio and the app identifies the species using a local ML model.

## Requirements

- Python 3.9+
- Node.js 18+ (for analytics dependencies)
- A modern browser (Chrome, Firefox, Edge)
- `frog_classifier.onnx` — place it in the project root

## Setup

**1. Install Python dependencies**

```bash
pip install -r requirements.txt
```

> On Linux you may need `pip3` instead of `pip`.

**2. Install Node.js dependencies (for Vercel Web Analytics)**

```bash
npm install
```

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

---

## Analytics

This project uses [Vercel Web Analytics](https://vercel.com/analytics) to track page views and user interactions. The analytics are configured using the `@vercel/analytics` package and load asynchronously from the Vercel CDN.

When deployed to Vercel, analytics data is automatically collected and viewable in your project dashboard.
