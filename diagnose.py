"""
Run this to inspect the ONNX model before guessing at fixes:
    python diagnose.py
"""

import json

import numpy as np
import onnxruntime as ort

MODEL_PATH = './frog_classifier.onnx'
N_MELS     = 64
N_FRAMES   = 157   # 5 s @ 16 kHz, hop 512 — what server.py feeds the model

session = ort.InferenceSession(MODEL_PATH, providers=['CPUExecutionProvider'])

print('=== Inputs ===')
for inp in session.get_inputs():
    print(f'  name={inp.name!r}  shape={inp.shape}  type={inp.type}')

print('\n=== Outputs ===')
for out in session.get_outputs():
    print(f'  name={out.name!r}  shape={out.shape}  type={out.type}')

print('\n=== Model metadata ===')
meta = session.get_modelmeta()
print(f'  producer={meta.producer_name!r}')
labels = None
for k, v in meta.custom_metadata_map.items():
    print(f'  {k}={v!r}')
    if k == 'labels':
        labels = json.loads(v)
if labels is None:
    print('  (no label metadata — server.py will fall back to its built-in list)')

input_name = session.get_inputs()[0].name

print('\n=== Sanity: does output change with different inputs? ===')
rng = np.random.default_rng(42)
shape = (1, 1, N_MELS, N_FRAMES)
for label, arr in [
    ('silence (-80 dB)', np.full(shape, -80.0, dtype=np.float32)),
    ('full scale (0 dB)', np.zeros(shape, dtype=np.float32)),
    ('random dB A     ', (rng.random(shape) * 80 - 80).astype(np.float32)),
    ('random dB B     ', (rng.random(shape) * 80 - 80).astype(np.float32)),
]:
    logits = session.run(None, {input_name: arr})[0][0]
    probs  = 1.0 / (1.0 + np.exp(-logits.astype(np.float64)))
    idx    = int(np.argmax(probs))
    top    = labels[idx] if labels else f'class {idx}'
    print(f'  {label} -> top: {top} ({probs[idx]:.3f})  '
          f'logits range [{logits.min():.2f}, {logits.max():.2f}]')
