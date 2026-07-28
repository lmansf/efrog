(function (global) {
  const MIN_DURATION_SECONDS = 0.75;
  const ACTIVE_SAMPLE_FLOOR = 0.0015;
  const MIN_PEAK = 0.003;
  const MIN_RMS = 0.0005;
  const MIN_ACTIVE_RATIO = 0.003;

  function summarizeSignal(samples, sampleRate = 16000) {
    if (!samples || !samples.length) {
      return {
        durationSeconds: 0,
        peak: 0,
        rms: 0,
        activeRatio: 0,
      };
    }

    let peak = 0;
    let sumSquares = 0;
    let activeSamples = 0;

    for (let i = 0; i < samples.length; i++) {
      const value = samples[i];
      const abs = Math.abs(value);
      if (abs > peak) peak = abs;
      sumSquares += value * value;
      if (abs >= ACTIVE_SAMPLE_FLOOR) activeSamples++;
    }

    return {
      durationSeconds: samples.length / sampleRate,
      peak,
      rms: Math.sqrt(sumSquares / samples.length),
      activeRatio: activeSamples / samples.length,
    };
  }

  function evaluate(result) {
    const signal = result?.signal;
    if (!signal) return { abstain: false, reason: null };

    if (signal.durationSeconds < MIN_DURATION_SECONDS) {
      return {
        abstain: true,
        reason: 'too-short',
        title: 'No frog call confidently detected',
        detail: 'This clip is too short for a trustworthy frog ID. Try recording at least a full second of clear audio.',
      };
    }

    if (
      signal.peak < MIN_PEAK &&
      signal.rms < MIN_RMS &&
      signal.activeRatio < MIN_ACTIVE_RATIO
    ) {
      return {
        abstain: true,
        reason: 'low-signal',
        title: 'No frog call confidently detected',
        detail: 'This clip did not contain enough usable frog-call signal to make a trustworthy identification.',
      };
    }

    return { abstain: false, reason: null };
  }

  const api = {
    thresholds: {
      MIN_DURATION_SECONDS,
      ACTIVE_SAMPLE_FLOOR,
      MIN_PEAK,
      MIN_RMS,
      MIN_ACTIVE_RATIO,
    },
    summarizeSignal,
    evaluate,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.TrustGuard = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
