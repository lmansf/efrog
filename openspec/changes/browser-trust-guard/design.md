## Context

`js/pages/record.js` currently treats the classifier response as trustworthy once the top class crosses a static 90% threshold. In the browser-first path, that happens before any signal-quality check, so silent input can be persisted and presented with the same collectible UI as a real frog call.

## Goals / Non-Goals

**Goals:**
- Add one clear browser-side owner for abstention decisions.
- Block confident result rendering, storage, and feedback prompts when the clip is clearly too short or too low-signal.
- Preserve the existing low-confidence behavior for non-frog clips that already fall below the confidence threshold.

**Non-Goals:**
- Retrain or replace the model.
- Repair Auth0, Supabase, or unrelated record-page defects.
- Redesign the broader result-card experience.

## Decisions

Add a dedicated `js/trust-guard.js` module-like global that owns two pure decisions: signal summarization from decoded PCM and abstention evaluation from those signal stats. This keeps thresholds and user-facing abstention copy in one place and provides a simple Node-testable surface without changing the app's script architecture.

Expose signal stats from `js/classifier.js` with the classification result rather than re-decoding audio in `record.js`. The classifier already has the decoded 16 kHz mono samples, so this avoids duplicate work and lets the guard inspect the exact audio that drove inference — the stats are summarized over the same truncated 5 s window that is fed to the mel spectrogram, not the whole decoded clip.

Fail closed when the guard is missing. `classify()` refuses to run without `TrustGuard`, and `record.js` abstains for any result that carries signal stats it cannot evaluate, so a failed `js/trust-guard.js` load surfaces as an error or an abstention instead of silently restoring the unguarded confident-card path.

Apply the trust guard in `js/pages/record.js` before any history entry, database write, or feedback prompt is created. This is the narrowest place that protects the user-facing result surface and persistence path without widening into server-side flows.

## Risks / Trade-offs

- Quiet real frog clips could be abstained if thresholds are too aggressive -> Use conservative low-signal thresholds that only target obvious silence / near-silence and keep the first fix narrow.
- Server-routed classification will only benefit from probability-based checks unless it also provides signal stats -> Keep this branch scoped to the browser-first defect identified in the audit.
- Adding a new script creates load-order risk -> Include it before `record.js` and keep the API global and dependency-free.
