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
CORS(app)

@app.after_request
def _cors(response):
    response.headers['Access-Control-Allow-Origin']  = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response

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
    # Replace any -inf from silent frames (doesn't affect typical frog audio)
    mel_db = np.nan_to_num(mel_db, nan=0.0, posinf=0.0, neginf=-80.0)

    if mel_db.shape[1] != 216:
        mel_db = zoom(mel_db, (1, 216 / mel_db.shape[1]), order=1)

    # Normalize to [0, 255] — matches training pipeline exactly
    lo, hi = mel_db.min(), mel_db.max()
    mel_norm = (
        ((mel_db - lo) / (hi - lo) * 255) if hi > lo
        else np.zeros_like(mel_db)
    ).astype(np.float32)

    # Resize (128, 216) → (224, 224) with bilinear zoom, same as tf.image.resize
    zy = 224 / mel_norm.shape[0]
    zx = 224 / mel_norm.shape[1]
    resized = zoom(mel_norm, (zy, zx), order=1)

    # Stack grayscale → RGB
    rgb = np.stack([resized, resized, resized], axis=-1)

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


@app.route('/classify', methods=['POST', 'OPTIONS'])
def classify():
    if request.method == 'OPTIONS':
        return '', 204
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
        print({sp: f'{float(preds[i]):.3f}' for i, sp in enumerate(LABEL_CLASSES)})
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


# ── Auth0 token verification ──────────────────────────────────────────────────
import json as _json
import urllib.request as _urllib

_AUTH0_DOMAIN   = os.environ.get('AUTH0_DOMAIN', '')
_AUTH0_AUDIENCE = os.environ.get('AUTH0_AUDIENCE', '')
_jwks_cache     = None

def _get_jwks():
    global _jwks_cache
    if _jwks_cache:
        return _jwks_cache
    with _urllib.urlopen(f'https://{_AUTH0_DOMAIN}/.well-known/jwks.json', timeout=5) as r:
        _jwks_cache = _json.loads(r.read())
    return _jwks_cache

def _verify_token(token: str) -> str:
    from jose import jwt as jose_jwt
    header = jose_jwt.get_unverified_header(token)
    key    = next((k for k in _get_jwks()['keys'] if k['kid'] == header['kid']), None)
    if not key:
        raise ValueError('Unknown signing key')
    payload = jose_jwt.decode(
        token, key,
        algorithms=['RS256'],
        audience=_AUTH0_AUDIENCE,
        issuer=f'https://{_AUTH0_DOMAIN}/',
    )
    return payload['sub']

def _require_auth():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return None, (jsonify({'error': 'Missing Authorization header'}), 401)
    try:
        return _verify_token(auth[7:]), None
    except Exception as exc:
        return None, (jsonify({'error': f'Invalid token: {exc}'}), 401)


# ── Databricks ────────────────────────────────────────────────────────────────
_DBC_HOST      = os.environ.get('DATABRICKS_HOST', '')
_DBC_HTTP_PATH = os.environ.get('DATABRICKS_HTTP_PATH', '')
_DBC_TOKEN     = os.environ.get('DATABRICKS_TOKEN', '')
_DBC_CATALOG   = os.environ.get('DATABRICKS_CATALOG', '')
_DBC_SCHEMA    = os.environ.get('DATABRICKS_SCHEMA', 'efrog')
_DBC_PREFIX    = f'{_DBC_CATALOG}.{_DBC_SCHEMA}' if _DBC_CATALOG else _DBC_SCHEMA

def _databricks_conn():
    from databricks import sql as _db_sql
    return _db_sql.connect(
        server_hostname=_DBC_HOST,
        http_path=_DBC_HTTP_PATH,
        access_token=_DBC_TOKEN,
    )

def _ensure_tables(cur):
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {_DBC_PREFIX}.observations (
            id            STRING,
            user_id       STRING,
            created_at    STRING,
            type          STRING,
            name          STRING,
            species       STRING,
            confidence    DOUBLE,
            probabilities STRING
        ) USING DELTA
    """)
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {_DBC_PREFIX}.feedback (
            id              STRING,
            user_id         STRING,
            observation_id  STRING,
            created_at      STRING,
            verdict         STRING,
            note            STRING
        ) USING DELTA
    """)

def _databricks_ready():
    return all([_DBC_HOST, _DBC_TOKEN, _AUTH0_DOMAIN])


# ── /sync ─────────────────────────────────────────────────────────────────────
@app.route('/sync', methods=['POST', 'OPTIONS'])
def sync_data():
    if request.method == 'OPTIONS':
        return '', 204
    if not _databricks_ready():
        return jsonify({'error': 'Databricks or Auth0 not configured on server'}), 503

    user_id, err = _require_auth()
    if err:
        return err

    data         = request.get_json(force=True) or {}
    observations = data.get('observations', [])
    feedback     = data.get('feedback', [])

    try:
        with _databricks_conn() as conn:
            with conn.cursor() as cur:
                _ensure_tables(cur)
                for obs in observations:
                    cur.execute(f"""
                        MERGE INTO {_DBC_PREFIX}.observations AS t
                        USING (SELECT %s AS id, %s AS user_id) AS s
                          ON t.id = s.id AND t.user_id = s.user_id
                        WHEN NOT MATCHED THEN INSERT
                          (id, user_id, created_at, type, name, species, confidence, probabilities)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """, [
                        obs.get('id'), user_id,
                        obs.get('id'), user_id,
                        obs.get('created_at', ''), obs.get('type', ''),
                        obs.get('name', ''),       obs.get('species', ''),
                        float(obs.get('confidence') or 0),
                        _json.dumps(obs.get('probabilities') or {}),
                    ])
                for fb in feedback:
                    cur.execute(f"""
                        MERGE INTO {_DBC_PREFIX}.feedback AS t
                        USING (SELECT %s AS id, %s AS user_id) AS s
                          ON t.id = s.id AND t.user_id = s.user_id
                        WHEN NOT MATCHED THEN INSERT
                          (id, user_id, observation_id, created_at, verdict, note)
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """, [
                        fb.get('id'), user_id,
                        fb.get('id'), user_id,
                        fb.get('observation_id', ''), fb.get('created_at', ''),
                        fb.get('verdict', ''),         fb.get('note', ''),
                    ])
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500

    return jsonify({'synced': {'observations': len(observations), 'feedback': len(feedback)}})


# ── /observations ─────────────────────────────────────────────────────────────
@app.route('/observations', methods=['GET', 'OPTIONS'])
def get_observations():
    if request.method == 'OPTIONS':
        return '', 204
    if not _databricks_ready():
        return jsonify({'error': 'Databricks or Auth0 not configured on server'}), 503

    user_id, err = _require_auth()
    if err:
        return err

    try:
        with _databricks_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT id, created_at, type, name, species, confidence, probabilities
                    FROM {_DBC_PREFIX}.observations
                    WHERE user_id = %s
                    ORDER BY created_at DESC
                """, [user_id])
                cols = [d[0] for d in cur.description]
                rows = []
                for row in cur.fetchall():
                    obs = dict(zip(cols, row))
                    try:
                        obs['probabilities'] = _json.loads(obs['probabilities'])
                    except Exception:
                        obs['probabilities'] = {}
                    rows.append(obs)
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500

    return jsonify({'observations': rows})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    host = '0.0.0.0' if os.environ.get('PORT') else '127.0.0.1'
    app.run(host=host, port=port, debug=False)
