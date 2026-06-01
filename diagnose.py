"""
Run this to inspect the ONNX model before guessing at fixes:
    python diagnose.py
"""

import numpy as np
import onnxruntime as ort

MODEL_PATH = './frog_classifier.onnx'

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
for k, v in meta.custom_metadata_map.items():
    print(f'  {k}={v!r}')

input_name = session.get_inputs()[0].name

print('\n=== Sanity: does output change with different inputs? ===')
rng = np.random.default_rng(42)
for label, arr in [
    ('zeros    ', np.zeros((1, 224, 224, 3), dtype=np.float32)),
    ('ones     ', np.ones((1, 224, 224, 3), dtype=np.float32)),
    ('random A ', rng.standard_normal((1, 224, 224, 3)).astype(np.float32)),
    ('random B ', rng.standard_normal((1, 224, 224, 3)).astype(np.float32)),
    ('ENet range', (rng.random((1, 224, 224, 3)).astype(np.float32) * 2 - 1)),
]:
    out = session.run(None, {input_name: arr})[0][0]
    print(f'  {label} -> {np.array2string(out, precision=4, suppress_small=True)}  argmax={np.argmax(out)}')
