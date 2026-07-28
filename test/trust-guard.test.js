const test = require('node:test');
const assert = require('node:assert/strict');

const TrustGuard = require('../js/trust-guard.js');

function sineWave({ durationSeconds, amplitude = 0.2, frequency = 440, sampleRate = 16000 }) {
  const samples = new Float32Array(Math.floor(durationSeconds * sampleRate));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return samples;
}

test('abstains on silent clips', () => {
  const signal = TrustGuard.summarizeSignal(new Float32Array(16000 * 5));
  const assessment = TrustGuard.evaluate({ signal });

  assert.equal(assessment.abstain, true);
  assert.equal(assessment.reason, 'low-signal');
});

test('abstains on clips that are too short', () => {
  const signal = TrustGuard.summarizeSignal(sineWave({ durationSeconds: 0.25, amplitude: 0.3 }));
  const assessment = TrustGuard.evaluate({ signal });

  assert.equal(assessment.abstain, true);
  assert.equal(assessment.reason, 'too-short');
});

test('abstains on near-silent noise', () => {
  const samples = new Float32Array(16000 * 5);
  samples.fill(0.0001);

  const signal = TrustGuard.summarizeSignal(samples);
  const assessment = TrustGuard.evaluate({ signal });

  assert.equal(assessment.abstain, true);
  assert.equal(assessment.reason, 'low-signal');
});

test('does not abstain on adequate-signal clips', () => {
  const signal = TrustGuard.summarizeSignal(sineWave({ durationSeconds: 5, amplitude: 0.2 }));
  const assessment = TrustGuard.evaluate({ signal });

  assert.equal(assessment.abstain, false);
  assert.equal(assessment.reason, null);
});
