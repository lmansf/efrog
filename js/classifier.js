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

// Base64-encode the raw little-endian bytes of a Float32Array. Used to ship the
// observation's mel spectrogram to Supabase compactly; the Python post-training
// pipeline decodes it with np.frombuffer(b64decode(s), '<f4').reshape(64, 157).
function _f32ToBase64(f32) {
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

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

const _OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;

async function _resampleToMono(decoded) {
  const targetRate = MEL_CONFIG.SAMPLE_RATE;
  const length = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new _OfflineCtx(1, length, targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

// Resample native-rate mono PCM → 16 kHz.
async function _resamplePcm(native, nativeRate) {
  const targetRate = MEL_CONFIG.SAMPLE_RATE;
  const targetLen = Math.max(1, Math.ceil((native.length / nativeRate) * targetRate));
  const offline = new _OfflineCtx(1, targetLen, targetRate);
  const buf = offline.createBuffer(1, native.length, nativeRate);
  buf.copyToChannel(native, 0);
  const src = offline.createBufferSource();
  src.buffer = buf;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

// Capture up to CAPTURE_SECS of audio from a video element in real time, then
// resample. Handles QuickTime (.mov) which decodeAudioData rejects on both
// desktop Chrome/Firefox and (for camera-captured files) iOS Safari, even though
// the <video> element itself can play them.
async function _decodeViaVideoElement(blob) {
  const CAPTURE_SECS = 5.5;

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.src = url;
    video.preload = 'auto';
    video.muted = false;          // muted element feeds silence into the graph
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');

    let settled = false;
    const fail = (msg) => {
      if (settled) return; settled = true;
      URL.revokeObjectURL(url);
      reject(new Error(msg));
    };

    video.onerror = () => fail('Could not read this video — try exporting it as MP4 or MP3 and re-uploading');

    video.onloadedmetadata = async () => {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      let ctx;
      try {
        ctx = new AudioCtx();
        // iOS starts the context suspended — must resume (the Analyze click is the gesture)
        if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }

        const nativeRate = ctx.sampleRate;
        const source = ctx.createMediaElementSource(video);
        const silencer = ctx.createGain();
        silencer.gain.value = 0;     // play inaudibly

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
          clearTimeout(capTimer);
          try { video.pause(); } catch {}
          try { proc.disconnect(); source.disconnect(); silencer.disconnect(); } catch {}
          await ctx.close().catch(() => {});
          URL.revokeObjectURL(url);

          const total = captured.reduce((s, a) => s + a.length, 0);
          if (total === 0) { if (!settled) { settled = true; reject(new Error('No audio track found in this video')); } return; }

          const native = new Float32Array(total);
          let off = 0;
          for (const c of captured) { native.set(c, off); off += c.length; }

          // Detect the iOS createMediaElementSource silence bug: all ~zero samples
          let peak = 0;
          for (let i = 0; i < native.length; i += 257) { const v = Math.abs(native[i]); if (v > peak) peak = v; }
          if (peak < 1e-5) {
            if (!settled) { settled = true; reject(new Error("Couldn't capture audio from this video on your device — try uploading the audio as an M4A or MP3 instead")); }
            return;
          }

          try {
            const out = await _resamplePcm(native, nativeRate);
            if (!settled) { settled = true; resolve(out); }
          } catch (e) {
            if (!settled) { settled = true; reject(e); }
          }
        };

        video.onended = finish;
        const capTimer = setTimeout(finish, (CAPTURE_SECS + 0.5) * 1000);

        await video.play().catch(() => fail('Your browser blocked silent video playback needed to read the audio — try uploading an M4A or MP3 instead'));
      } catch (e) {
        if (ctx) ctx.close().catch(() => {});
        fail('Could not decode the audio from this video — try uploading an M4A or MP3 instead');
      }
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
    if (!samples || !samples.length) {
      throw new Error('Could not read that audio file — it may be empty or corrupt');
    }

    if (!window.TrustGuard?.summarizeSignal) {
      throw new Error('Classification trust check failed to load — reload the page and try again');
    }

    const clip = samples.length > DURATION_SAMPLES
      ? samples.subarray(0, DURATION_SAMPLES)
      : samples;
    const signal = window.TrustGuard.summarizeSignal(clip, MEL_CONFIG.SAMPLE_RATE);

    const { data, nMels, nFrames } = melSpectrogram(clip, DURATION_SAMPLES);
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
      signal,
      // Exact model input (log-mel dB, shape [nMels, nFrames] row-major), base64
      // float32 — stored with the observation so it can train the RL model later.
      mel:           _f32ToBase64(data),
      melShape:      [nMels, nFrames],
    };
  },
};
