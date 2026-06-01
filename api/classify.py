from http.server import BaseHTTPRequestHandler
import cgi
import io
import json
import os
import tempfile
import numpy as np

LABEL_CLASSES = ['cane_toad', 'oak_toad', 'southern_toad']
SAMPLE_RATE   = 22050
DURATION      = 5.0
N_MELS        = 128

_session    = None
_input_name = None

def _get_session():
    global _session, _input_name
    if _session is not None:
        return _session, _input_name
    import onnxruntime as ort
    model_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'frog_classifier.onnx')
    _session    = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])
    _input_name = _session.get_inputs()[0].name
    return _session, _input_name


def audio_to_model_input(path):
    import librosa
    from scipy.ndimage import zoom

    audio, _ = librosa.load(path, sr=SAMPLE_RATE, duration=DURATION)
    target   = int(SAMPLE_RATE * DURATION)
    if len(audio) < target:
        audio = np.pad(audio, (0, target - len(audio)))
    else:
        audio = audio[:target]

    mel    = librosa.feature.melspectrogram(
        y=audio, sr=SAMPLE_RATE, n_mels=N_MELS, n_fft=2048, hop_length=512,
    )
    mel_db = librosa.power_to_db(mel, ref=np.max)
    mel_db = np.nan_to_num(mel_db, nan=0.0, posinf=0.0, neginf=-80.0)

    if mel_db.shape[1] != 216:
        mel_db = zoom(mel_db, (1, 216 / mel_db.shape[1]), order=1)

    lo, hi   = mel_db.min(), mel_db.max()
    mel_norm = (
        ((mel_db - lo) / (hi - lo) * 255) if hi > lo else np.zeros_like(mel_db)
    ).astype(np.float32)

    zy, zx  = 224 / mel_norm.shape[0], 224 / mel_norm.shape[1]
    resized = zoom(mel_norm, (zy, zx), order=1)

    rgb = np.stack([resized, resized, resized], axis=-1)
    rgb = rgb / 127.5 - 1.0

    return np.expand_dims(rgb, axis=0).astype(np.float32)


class handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            ctype  = self.headers.get('Content-Type', '')
            body   = self.rfile.read(length)

            fields = cgi.FieldStorage(
                fp=io.BytesIO(body),
                headers=self.headers,
                environ={'REQUEST_METHOD': 'POST', 'CONTENT_TYPE': ctype},
            )

            if 'audio' not in fields:
                return self._reply(400, {'error': 'No audio field in request'})

            item = fields['audio']
            ext  = os.path.splitext(getattr(item, 'filename', '') or '')[1] or '.wav'

            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                tmp.write(item.file.read())
                tmp_path = tmp.name

            try:
                sess, inp = _get_session()
                x         = audio_to_model_input(tmp_path)
                preds     = sess.run(None, {inp: x})[0][0]
                idx       = int(np.argmax(preds))
                self._reply(200, {
                    'species':       LABEL_CLASSES[idx],
                    'confidence':    float(preds[idx]),
                    'probabilities': {sp: float(preds[i]) for i, sp in enumerate(LABEL_CLASSES)},
                })
            finally:
                os.unlink(tmp_path)

        except Exception as exc:
            self._reply(500, {'error': str(exc)})

    def _reply(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, *_):
        pass
