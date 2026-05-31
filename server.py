"""
efrog classification server
────────────────────────────
Usage:
    python server.py

Model path (pick one):
  • Set EFROG_MODEL_PATH env var to your .onnx file
  • Or place frog_classifier.onnx next to server.py (the default)
"""

import os
import tempfile

import numpy as np
import librosa
from scipy.ndimage import zoom
from PIL import Image
import onnxruntime as ort
from flask import Flask, request, jsonify
from flask_cors import CORS

# ── Config ───────────────────────────────────────────────────────────────────
MODEL_PATH    = os.environ.get('EFROG_MODEL_PATH', './frog_classifier.onnx')
LABEL_CLASSES = ['cane_toad', 'oak_toad', 'southern_toad']
SAMPLE_RATE   = 22050
DURATION      = 5.0
N_MELS        = 128

app = Flask(__name__)
CORS(app)   # allows requests from file:// and any localhost origin

# ── Load model at startup ─────────────────────────────────────────────────────
print(f'Loading model from {MODEL_PATH!r} …')
try:
    _providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
    session    = ort.InferenceSession(MODEL_PATH, providers=_providers)
    input_name = session.get_inputs()[0].name
    print(f'Model ready.  Input: {input_name!r}  '
          f'Provider: {session.get_providers()[0]}')
    # Run one dummy inference so ONNX compiles/optimises the graph now,
    # not on the first real request (which would cause a timeout).
    _dummy = np.zeros((1, 224, 224, 3), dtype=np.float32)
    session.run(None, {input_name: _dummy})
    print('Warm-up done — first inference is ready.')
except Exception as exc:
    print(f'ERROR: could not load model — {exc}')
    print('Set EFROG_MODEL_PATH or place frog_classifier.onnx next to server.py.')
    session    = None
    input_name = None


# ── Audio → model input ───────────────────────────────────────────────────────
def audio_to_model_input(path: str) -> np.ndarray:
    audio, _ = librosa.load(path, sr=SAMPLE_RATE, duration=DURATION)

    target_len = int(SAMPLE_RATE * DURATION)
    if len(audio) < target_len:
        audio = np.pad(audio, (0, target_len - len(audio)), mode='constant')
    else:
        audio = audio[:target_len]

    mel = librosa.feature.melspectrogram(
        y=audio, sr=SAMPLE_RATE, n_mels=N_MELS, n_fft=2048, hop_length=512,
    )
    mel_db = librosa.power_to_db(mel, ref=np.max)

    if mel_db.shape[1] != 216:
        mel_db = zoom(mel_db, (1, 216 / mel_db.shape[1]), order=1)

    mel_norm = (
        (mel_db - mel_db.min()) / (mel_db.max() - mel_db.min()) * 255
    ).astype(np.uint8)

    # Resize to 224×224 (matches EfficientNetB0 input)
    img = Image.fromarray(mel_norm, mode='L').resize((224, 224), Image.BILINEAR)
    arr = np.array(img, dtype=np.float32)

    # Stack grayscale → RGB
    rgb = np.stack([arr, arr, arr], axis=-1)

    # EfficientNet preprocess_input: scale to [-1, 1]
    rgb = rgb / 127.5 - 1.0

    return np.expand_dims(rgb, axis=0).astype(np.float32)


# ── Routes ────────────────────────────────────────────────────────────────────
@app.route('/health')
def health():
    return jsonify({
        'status':  'ok' if session else 'no_model',
        'classes': LABEL_CLASSES,
    })


@app.route('/classify', methods=['POST'])
def classify():
    if session is None:
        return jsonify({'error': 'Model not loaded — check server logs'}), 503

    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file in request (field name: "audio")'}), 400

    file = request.files['audio']
    ext  = os.path.splitext(file.filename or '')[1] or '.wav'

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        x     = audio_to_model_input(tmp_path)
        preds = session.run(None, {input_name: x})[0][0]
        idx   = int(np.argmax(preds))
        return jsonify({
            'species':       LABEL_CLASSES[idx],
            'confidence':    float(preds[idx]),
            'probabilities': {
                sp: float(preds[i]) for i, sp in enumerate(LABEL_CLASSES)
            },
        })
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500
    finally:
        os.unlink(tmp_path)


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=False)
