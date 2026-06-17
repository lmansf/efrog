// In-browser frog-call classifier. Loads the ONNX model with onnxruntime-web
// and runs the whole prediction client-side — decode audio → 16 kHz mono →
// mel spectrogram (matched to efrog/server.py) → model → sigmoid. No backend
// is involved, so there is no server to wake and nothing to time out.
//
// window.Classifier = { ready, status(), classify(blob), labels }

import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/+esm';
import { melSpectrogram, MEL_CONFIG } from './melspectrogram.js';

// Load the wasm binaries from the matching versioned dist dir. Force a single
// thread: multi-threaded wasm needs SharedArrayBuffer, which requires
// cross-origin-isolation headers (COOP/COEP) that a plain static host (Vercel)
// doesn't send. The model is tiny, so single-threaded inference is plenty fast.
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

const MODEL_URL  = window.EFROG_MODEL_URL  || './frog_classifier.onnx';
const LABELS_URL = window.EFROG_LABELS_URL || './labels.json';
const DURATION_SAMPLES = MEL_CONFIG.SAMPLE_RATE * 5;   // 5 s clip, matches the server

// Fallback labels if labels.json is absent — must match the order the model was
// trained in (the same list server.py falls back to).
const FALLBACK_LABELS = [
  'Barking Treefrog', 'Bullfrog', 'Carpenter Frog',
  'Coastal Plains Leopard Frog', "Cope's Gray Treefrog", 'Cuban Tree Frog',
  'Eastern Narrow-mouthed Toad', 'Eastern Spadefoot', 'Green Frog',
  'Green Treefrog', 'Little Grass Frog', 'Oak Toad', 'Pig Frog',
  'Pine Woods Treefrog', 'River Frog', 'Southern Cricket Frog',
  'Southern Leopard Frog', 'Squirrel Treefrog',
];

let _session = null;
let _labels  = null;
let _state   = 'loading';   // 'loading' | 'ok' | 'error'
let _inputName  = 'input';
let _outputName = 'output';

async function _loadLabels() {
  try {
    const res = await fetch(LABELS_URL, { cache: 'force-cache' });
    if (res.ok) {
      const arr = await res.json();
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch { /* fall through */ }
  return FALLBACK_LABELS;
}

const ready = (async () => {
  try {
    const [session, labels] = await Promise.all([
      ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      }),
      _loadLabels(),
    ]);
    _session = session;
    _labels  = labels;
    _inputName  = session.inputNames?.[0]  ?? 'input';
    _outputName = session.outputNames?.[0] ?? 'output';

    // Warm up: a real inference path so the first user click is instant. Also
    // validates that the model's output width matches the label list.
    const dummy = new ort.Tensor('float32',
      new Float32Array(MEL_CONFIG.N_MELS * 157),
      [1, 1, MEL_CONFIG.N_MELS, 157]);
    const out = await session.run({ [_inputName]: dummy });
    const n = out[_outputName].data.length;
    if (n !== _labels.length) {
      console.warn(`[Classifier] model outputs ${n} classes but ${_labels.length} labels are configured`);
      if (n < _labels.length) _labels = _labels.slice(0, n);
    }
    _state = 'ok';
  } catch (err) {
    _state = 'error';
    console.error('[Classifier] failed to load model:', err);
    throw err;
  }
})();

// ── Audio → 16 kHz mono Float32 (mirrors ffmpeg -ac 1 -ar 16000 in the server) ──
async function _decodeTo16kMono(blob) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) throw new Error('Web Audio API not supported in this browser');

  // Try fast path: decodeAudioData (works for audio/*, mp4, webm; fails for .mov on desktop)
  const arrayBuf = await blob.arrayBuffer();
  let decoded = null;
  const ctx0 = new AudioCtx();
  try {
    decoded = await ctx0.decodeAudioData(arrayBuf);
  } catch { /* fall through to video-element path */ }
  finally { ctx0.close(); }

  if (decoded) {
    return _resampleToMono(decoded);
  }

  // Fallback: route audio through an HTMLVideoElement + ScriptProcessor.
  // This handles QuickTime (.mov) on desktop Chrome/Firefox, which decodeAudioData
  // cannot decode even though the video element can play it.
  return _decodeViaVideoElement(blob);
}

async function _resampleToMono(decoded) {
  const targetRate = MEL_CONFIG.SAMPLE_RATE;
  const length = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineAudioContext(1, length, targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

// Capture up to CAPTURE_SECS of audio from a video element, then resample.
// The classifier only needs 5 s, so we stop early to avoid wasting time on long videos.
async function _decodeViaVideoElement(blob) {
  const CAPTURE_SECS = 5.5;
  const targetRate = MEL_CONFIG.SAMPLE_RATE;

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.src = url;
    video.preload = 'auto';
    video.playsInline = true;

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode this video — try exporting as MP4 or MP3 and re-uploading'));
    };

    video.onloadedmetadata = () => {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const nativeRate = ctx.sampleRate;
      const source = ctx.createMediaElementSource(video);

      // Silence output so the video plays without being audible
      const silencer = ctx.createGain();
      silencer.gain.value = 0;

      const captured = [];
      let finished = false;

      const proc = ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = e => {
        if (finished) return;
        captured.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };

      source.connect(proc);
      proc.connect(silencer);
      silencer.connect(ctx.destination);

      const finish = async () => {
        if (finished) return;
        finished = true;
        video.pause();
        proc.disconnect();
        source.disconnect();
        await ctx.close().catch(() => {});
        URL.revokeObjectURL(url);

        // Flatten captured chunks
        const total = captured.reduce((s, a) => s + a.length, 0);
        const native = new Float32Array(total);
        let off = 0;
        for (const c of captured) { native.set(c, off); off += c.length; }

        // Resample native-rate mono PCM → 16 kHz via OfflineAudioContext
        const targetLen = Math.max(1, Math.ceil((native.length / nativeRate) * targetRate));
        try {
          const offline = new OfflineAudioContext(1, targetLen, targetRate);
          const buf = offline.createBuffer(1, native.length, nativeRate);
          buf.copyToChannel(native, 0);
          const src = offline.createBufferSource();
          src.buffer = buf;
          src.connect(offline.destination);
          src.start();
          const rendered = await offline.startRendering();
          resolve(rendered.getChannelData(0));
        } catch (e) {
          reject(e);
        }
      };

      video.onended = finish;
      // Stop capture after CAPTURE_SECS so we don't wait through a 10-minute video
      setTimeout(finish, (CAPTURE_SECS + 0.5) * 1000);

      video.play().catch(e => {
        URL.revokeObjectURL(url);
        reject(new Error('Browser blocked video playback — try a different file format'));
      });
    };
  });
}

// ── Public API ────────────────────────────────────────────────────────────────
window.Classifier = {
  ready,
  status: () => _state,
  get labels() { return _labels ? [..._labels] : []; },

  async classify(blob) {
    await ready;
    if (_state !== 'ok' || !_session) throw new Error('Classifier model is not loaded');

    const samples = await _decodeTo16kMono(blob);
    if (!samples || samples.length < MEL_CONFIG.SAMPLE_RATE / 2) {
      throw new Error('Could not read that audio file — it may be empty or corrupt');
    }

    const { data, nMels, nFrames } = melSpectrogram(samples, DURATION_SAMPLES);
    const input = new ort.Tensor('float32', data, [1, 1, nMels, nFrames]);
    const output = await _session.run({ [_inputName]: input });
    const logits = output[_outputName].data;   // raw logits

    const probs = new Array(_labels.length);
    let bestIdx = 0;
    for (let i = 0; i < _labels.length; i++) {
      probs[i] = 1 / (1 + Math.exp(-logits[i]));   // per-class sigmoid, like the server
      if (probs[i] > probs[bestIdx]) bestIdx = i;
    }

    const probabilities = {};
    _labels.forEach((sp, i) => { probabilities[sp] = probs[i]; });
    return {
      species:       _labels[bestIdx],
      confidence:    probs[bestIdx],
      probabilities,
    };
  },
};
