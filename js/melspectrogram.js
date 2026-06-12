// Mel spectrogram in pure JS, matched to the exact librosa call in
// efrog/server.py (clip_to_mel): power mel spectrogram with n_fft=1024,
// hop=512, n_mels=64, fmin=0, fmax=sr/2, Slaney mel scale + Slaney norm,
// center padding (reflect), periodic Hann window, then power_to_db(ref=max)
// clipped to a top_db of 80. Output values land in roughly [-80, 0] dB, the
// range the model was trained on.
//
// Verified numerically against librosa (see scripts/mel_parity test) to well
// under 1 dB max error, which is far tighter than the model needs.

const SAMPLE_RATE = 16000;
const N_FFT       = 1024;
const HOP_LENGTH  = 512;
const N_MELS      = 64;
const FMIN        = 0;
const FMAX        = SAMPLE_RATE / 2;
const TOP_DB      = 80;
const AMIN        = 1e-10;

// ── Periodic Hann window (matches scipy get_window('hann', N, fftbins=True)) ──
const _hann = new Float32Array(N_FFT);
for (let n = 0; n < N_FFT; n++) {
  _hann[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT);
}

// ── Slaney mel scale (htk=False), matching librosa.hz_to_mel / mel_to_hz ──
function hzToMel(hz) {
  const fMin = 0.0;
  const fSp  = 200.0 / 3;
  let mel = (hz - fMin) / fSp;
  const minLogHz  = 1000.0;
  const minLogMel = (minLogHz - fMin) / fSp;
  const logstep   = Math.log(6.4) / 27.0;
  if (hz >= minLogHz) mel = minLogMel + Math.log(hz / minLogHz) / logstep;
  return mel;
}

function melToHz(mel) {
  const fMin = 0.0;
  const fSp  = 200.0 / 3;
  let hz = fMin + fSp * mel;
  const minLogHz  = 1000.0;
  const minLogMel = (minLogHz - fMin) / fSp;
  const logstep   = Math.log(6.4) / 27.0;
  if (mel >= minLogMel) hz = minLogHz * Math.exp(logstep * (mel - minLogMel));
  return hz;
}

// ── Mel filterbank (n_mels × (n_fft/2+1)), librosa.filters.mel defaults ──
function buildMelFilterbank() {
  const nBins = 1 + N_FFT / 2;                          // 513
  const fftFreqs = new Float64Array(nBins);
  for (let i = 0; i < nBins; i++) fftFreqs[i] = (i * SAMPLE_RATE) / N_FFT;

  const melMin = hzToMel(FMIN);
  const melMax = hzToMel(FMAX);
  const melPts = new Float64Array(N_MELS + 2);
  for (let i = 0; i < N_MELS + 2; i++) {
    melPts[i] = melToHz(melMin + ((melMax - melMin) * i) / (N_MELS + 1));
  }

  const fdiff = new Float64Array(N_MELS + 1);
  for (let i = 0; i < N_MELS + 1; i++) fdiff[i] = melPts[i + 1] - melPts[i];

  // weights[m] holds {start, end, values} for the non-zero span — sparse, since
  // each triangular filter only touches a small contiguous run of FFT bins.
  const filters = [];
  for (let m = 0; m < N_MELS; m++) {
    const enorm = 2.0 / (melPts[m + 2] - melPts[m]);     // Slaney normalization
    let start = -1, end = -1;
    const vals = [];
    for (let k = 0; k < nBins; k++) {
      const lower = -(melPts[m]     - fftFreqs[k]) / fdiff[m];
      const upper =  (melPts[m + 2] - fftFreqs[k]) / fdiff[m + 1];
      const w = Math.max(0, Math.min(lower, upper)) * enorm;
      if (w > 0) {
        if (start === -1) start = k;
        end = k;
        vals.push(w);
      } else if (start !== -1 && k > end) {
        break;                                           // past this filter's span
      }
    }
    filters.push({ start, values: start === -1 ? [] : vals });
  }
  return filters;
}

const _melFilters = buildMelFilterbank();

// ── Iterative radix-2 FFT (N_FFT is a power of two) ──
const _bitrev = (() => {
  const rev = new Uint32Array(N_FFT);
  const bits = Math.log2(N_FFT);
  for (let i = 0; i < N_FFT; i++) {
    let x = i, r = 0;
    for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  return rev;
})();

const _cos = new Float32Array(N_FFT / 2);
const _sin = new Float32Array(N_FFT / 2);
for (let i = 0; i < N_FFT / 2; i++) {
  _cos[i] = Math.cos((-2 * Math.PI * i) / N_FFT);
  _sin[i] = Math.sin((-2 * Math.PI * i) / N_FFT);
}

// In-place FFT of real input `re` (length N_FFT); `im` is scratch. Returns power
// (re²+im²) for bins 0..N_FFT/2 written into `outPower`.
function fftPower(re, im, outPower) {
  for (let i = 0; i < N_FFT; i++) {
    const j = _bitrev[i];
    if (j > i) { const tr = re[i]; re[i] = re[j]; re[j] = tr; }
  }
  im.fill(0);
  for (let size = 2; size <= N_FFT; size <<= 1) {
    const half = size >> 1;
    const step = N_FFT / size;
    for (let i = 0; i < N_FFT; i += size) {
      for (let k = 0; k < half; k++) {
        const tw = k * step;
        const c = _cos[tw], s = _sin[tw];
        const a = i + k, b = i + k + half;
        const reB = re[b] * c - im[b] * s;
        const imB = re[b] * s + im[b] * c;
        re[b] = re[a] - reB; im[b] = im[a] - imB;
        re[a] += reB;        im[a] += imB;
      }
    }
  }
  for (let k = 0; k <= N_FFT / 2; k++) outPower[k] = re[k] * re[k] + im[k] * im[k];
}

/**
 * Pad or truncate a mono 16 kHz signal to exactly DURATION seconds, then return
 * its log-mel spectrogram as a Float32Array of shape (N_MELS, nFrames) in
 * row-major order, plus the dims — ready to wrap as an ONNX (1,1,N_MELS,T) tensor.
 */
export function melSpectrogram(samples, durationSamples) {
  // Pad / truncate to the model's clip length
  let clip = samples;
  if (clip.length < durationSamples) {
    const padded = new Float32Array(durationSamples);
    padded.set(clip);
    clip = padded;
  } else if (clip.length > durationSamples) {
    clip = clip.subarray(0, durationSamples);
  }

  // librosa center=True with the 0.10+ default pad_mode='constant': zero-pad by
  // n_fft/2 each side. The Float32Array is already zero-filled, so we only place
  // the clip in the middle.
  const pad = N_FFT / 2;
  const padded = new Float32Array(clip.length + N_FFT);
  padded.set(clip, pad);

  const nFrames = 1 + Math.floor(clip.length / HOP_LENGTH);   // 157 for 5 s
  const nBins   = 1 + N_FFT / 2;
  const re    = new Float32Array(N_FFT);
  const im    = new Float32Array(N_FFT);
  const power = new Float32Array(nBins);
  const mel   = new Float32Array(N_MELS * nFrames);

  let maxMel = -Infinity;
  for (let t = 0; t < nFrames; t++) {
    const offset = t * HOP_LENGTH;
    for (let n = 0; n < N_FFT; n++) re[n] = padded[offset + n] * _hann[n];
    fftPower(re, im, power);

    for (let m = 0; m < N_MELS; m++) {
      const f = _melFilters[m];
      let acc = 0;
      for (let k = 0; k < f.values.length; k++) acc += f.values[k] * power[f.start + k];
      mel[m * nFrames + t] = acc;
      if (acc > maxMel) maxMel = acc;
    }
  }

  // power_to_db(ref=np.max) with top_db=80
  const refDb = 10 * Math.log10(Math.max(AMIN, maxMel));
  const floor = -TOP_DB;                                       // result max is 0
  for (let i = 0; i < mel.length; i++) {
    let db = 10 * Math.log10(Math.max(AMIN, mel[i])) - refDb;
    if (db < floor) db = floor;
    if (!Number.isFinite(db)) db = floor;                      // matches nan_to_num
    mel[i] = db;
  }

  return { data: mel, nMels: N_MELS, nFrames };
}

export const MEL_CONFIG = { SAMPLE_RATE, N_FFT, HOP_LENGTH, N_MELS };
