"""
efrog classification server
────────────────────────────
Usage:
    python server.py

Model path (pick one):
  • Set EFROG_MODEL_PATH env var to your .onnx file
  • Or place frog_classifier.onnx next to server.py (the default)
"""

import json
import os
import subprocess
import tempfile
import threading

import numpy as np
import librosa
import onnxruntime as ort
from flask import Flask, request, jsonify
from flask_cors import CORS

# ── Config ───────────────────────────────────────────────────────────────────
MODEL_PATH    = os.environ.get('EFROG_MODEL_PATH', './frog_classifier.onnx')
# Fallback class list — only used when the model file carries no 'labels'
# metadata (models exported by efrog-training embed their own label list).
LABEL_CLASSES = [
    'Barking Treefrog', 'Bullfrog', 'Carpenter Frog',
    'Coastal Plains Leopard Frog', "Cope's Gray Treefrog", 'Cuban Tree Frog',
    'Eastern Narrow-mouthed Toad', 'Eastern Spadefoot', 'Green Frog',
    'Green Treefrog', 'Little Grass Frog', 'Oak Toad', 'Pig Frog',
    'Pine Woods Treefrog', 'River Frog', 'Southern Cricket Frog',
    'Southern Leopard Frog', 'Squirrel Treefrog',
]
SAMPLE_RATE   = 16000
DURATION      = 5.0
N_MELS        = 64
N_FFT         = 1024
HOP_LENGTH    = 512

MAX_UPLOAD_MB = 25   # keep in sync with MAX_UPLOAD_MB in js/pages/record.js

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = MAX_UPLOAD_MB * 1024 * 1024
CORS(app)

@app.errorhandler(413)
def _too_large(_):
    return jsonify({'error': f'File is too large — the limit is {MAX_UPLOAD_MB} MB'}), 413

@app.after_request
def _cors(response):
    response.headers['Access-Control-Allow-Origin']  = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response

# ── Load model in background thread ──────────────────────────────────────────
# Loading in a thread lets gunicorn start up immediately; the boot screen polls
# /health until status == 'ok'.
session      = None
input_name   = None
_model_state = 'loading'   # 'loading' | 'ok' | 'error'

def _load_model():
    global session, input_name, LABEL_CLASSES, _model_state
    print(f'Loading model from {MODEL_PATH!r} …')
    try:
        _providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
        sess       = ort.InferenceSession(MODEL_PATH, providers=_providers)
        iname      = sess.get_inputs()[0].name
        print(f'Model ready.  Input: {iname!r}  Provider: {sess.get_providers()[0]}')

        # Class list travels with the model (efrog-training embeds it at export)
        meta   = sess.get_modelmeta().custom_metadata_map
        labels = LABEL_CLASSES
        if 'labels' in meta:
            labels = json.loads(meta['labels'])
            print(f'Loaded {len(labels)} class labels from model metadata.')
        else:
            print('No label metadata in model — using built-in class list.')
        out_dim = sess.get_outputs()[0].shape[-1]
        if isinstance(out_dim, int) and out_dim != len(labels):
            raise RuntimeError(
                f'model has {out_dim} outputs but {len(labels)} labels configured')

        _dummy = np.zeros((1, 1, N_MELS, 157), dtype=np.float32)
        sess.run(None, {iname: _dummy})
        print('Warm-up done — first inference is ready.')
        session, input_name, LABEL_CLASSES, _model_state = sess, iname, labels, 'ok'
    except Exception as exc:
        print(f'ERROR: could not load model — {exc}')
        _model_state = 'error'

threading.Thread(target=_load_model, daemon=True).start()


# ── Audio → model input ───────────────────────────────────────────────────────
def _ffmpeg_decode(path: str) -> np.ndarray:
    """Decode any audio format to 16 kHz mono float32 via ffmpeg.
    Far faster than librosa's audioread path for compressed formats."""
    cmd = [
        'ffmpeg', '-y', '-i', path,
        '-t', str(DURATION),   # only the first 5 s is classified — bounds decode time
        '-ac', '1',
        '-ar', str(SAMPLE_RATE),
        '-f', 'f32le',
        '-loglevel', 'error',
        'pipe:1',
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=20)
    if result.returncode != 0:
        raise RuntimeError(f'ffmpeg decode failed: {result.stderr.decode()[:300]}')
    return np.frombuffer(result.stdout, dtype=np.float32)


def audio_to_model_input(path: str) -> np.ndarray:
    try:
        audio = _ffmpeg_decode(path)
    except FileNotFoundError:
        # No ffmpeg on PATH (e.g. local dev) — librosa is slower but works
        audio, _ = librosa.load(path, sr=SAMPLE_RATE, mono=True, duration=DURATION)
        audio = audio.astype(np.float32)
    if len(audio) == 0:
        raise ValueError('the file contains no audio samples')

    target_len = int(SAMPLE_RATE * DURATION)
    if len(audio) < target_len:
        audio = np.pad(audio, (0, target_len - len(audio)), mode='constant')
    else:
        audio = audio[:target_len]

    # Power mel spectrogram (matches torchaudio.transforms.MelSpectrogram defaults)
    mel = librosa.feature.melspectrogram(
        y=audio, sr=SAMPLE_RATE, n_mels=N_MELS, n_fft=N_FFT, hop_length=HOP_LENGTH,
        power=2.0,
    )
    # Convert to dB (matches torchaudio.transforms.AmplitudeToDB)
    mel_db = librosa.power_to_db(mel, ref=np.max)
    mel_db = np.nan_to_num(mel_db, nan=0.0, posinf=0.0, neginf=-80.0)

    # Shape: (batch=1, channel=1, n_mels=64, time)
    return mel_db[np.newaxis, np.newaxis, :, :].astype(np.float32)


# ── Routes ────────────────────────────────────────────────────────────────────
@app.route('/health')
def health():
    return jsonify({
        'status':  _model_state,   # 'loading' | 'ok' | 'error'
        'classes': LABEL_CLASSES,
    })


@app.route('/classify', methods=['POST', 'OPTIONS'])
def classify():
    if request.method == 'OPTIONS':
        return '', 204
    if _model_state == 'loading':
        return jsonify({'error': 'Model is still loading — please wait a moment'}), 503
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
        try:
            x = audio_to_model_input(tmp_path)
        except Exception as exc:
            # Bad input, not a server fault — undecodable, corrupt, or empty audio
            reason = str(exc) or 'it does not appear to be a valid audio file'
            return jsonify({'error': f'Could not read that audio file: {reason}'}), 400
        logits = session.run(None, {input_name: x})[0][0]  # raw sigmoid logits
        probs  = 1.0 / (1.0 + np.exp(-logits.astype(np.float64)))  # sigmoid
        idx    = int(np.argmax(probs))
        print({sp: f'{float(probs[i]):.3f}' for i, sp in enumerate(LABEL_CLASSES)})
        return jsonify({
            'species':       LABEL_CLASSES[idx],
            'confidence':    float(probs[idx]),
            'probabilities': {
                sp: float(probs[i]) for i, sp in enumerate(LABEL_CLASSES)
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
            username      STRING,
            created_at    STRING,
            type          STRING,
            name          STRING,
            duration      DOUBLE,
            species       STRING,
            confidence    DOUBLE,
            probabilities STRING
        ) USING DELTA
    """)
    for col in ['username STRING', 'duration DOUBLE']:
        try:
            cur.execute(f"ALTER TABLE {_DBC_PREFIX}.observations ADD COLUMN IF NOT EXISTS {col}")
        except Exception:
            pass
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {_DBC_PREFIX}.feedback (
            id              STRING,
            user_id         STRING,
            observation_id  STRING,
            created_at      STRING,
            name            STRING,
            accuracy_rating INT,
            site_rating     INT,
            frogwatch       STRING,
            note            STRING,
            species         STRING,
            confidence      DOUBLE,
            user_agent      STRING
        ) USING DELTA
    """)

def _databricks_ready():
    return all([_DBC_HOST, _DBC_TOKEN, _AUTH0_DOMAIN])


# ── /sync ─────────────────────────────────────────────────────────────────────
@app.route('/sync', methods=['POST', 'OPTIONS'])
def sync_data():
    if request.method == 'OPTIONS':
        return '', 204

    user_id, err = _require_auth()
    if err:
        return err

    if not _databricks_ready():
        return jsonify({'error': 'Databricks or Auth0 not configured on server'}), 503

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
                          (id, user_id, username, created_at, type, name, duration, species, confidence, probabilities)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, [
                        obs.get('id'), user_id,
                        obs.get('id'), user_id,
                        obs.get('username', ''),
                        obs.get('created_at', ''), obs.get('type', ''),
                        obs.get('name', ''),
                        float(obs['duration']) if obs.get('duration') is not None else None,
                        obs.get('species', ''),
                        float(obs.get('confidence') or 0),
                        _json.dumps(obs.get('probabilities') or {}),
                    ])
                for fb in feedback:
                    cur.execute(f"""
                        MERGE INTO {_DBC_PREFIX}.feedback AS t
                        USING (SELECT %s AS id, %s AS user_id) AS s
                          ON t.id = s.id AND t.user_id = s.user_id
                        WHEN NOT MATCHED THEN INSERT
                          (id, user_id, observation_id, created_at, name,
                           accuracy_rating, site_rating, frogwatch, note,
                           species, confidence, user_agent)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, [
                        fb.get('id'), user_id,
                        fb.get('id'), user_id,
                        fb.get('observation_id', ''), fb.get('created_at', ''),
                        fb.get('name', ''),
                        int(fb['accuracy_rating']) if fb.get('accuracy_rating') is not None else None,
                        int(fb['site_rating'])     if fb.get('site_rating')     is not None else None,
                        fb.get('frogwatch', ''),   fb.get('note', ''),
                        fb.get('species', ''),
                        float(fb['confidence']) if fb.get('confidence') is not None else None,
                        fb.get('user_agent', ''),
                    ])
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500

    return jsonify({'synced': {'observations': len(observations), 'feedback': len(feedback)}})


# ── /observations ─────────────────────────────────────────────────────────────
@app.route('/observations', methods=['GET', 'OPTIONS'])
def get_observations():
    if request.method == 'OPTIONS':
        return '', 204

    user_id, err = _require_auth()
    if err:
        return err

    if not _databricks_ready():
        return jsonify({'error': 'Databricks or Auth0 not configured on server'}), 503

    try:
        with _databricks_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT id, created_at, type, name, duration, species, confidence, probabilities
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
