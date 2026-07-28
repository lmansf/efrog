## Why

The browser app can currently turn a 5-second silent clip into a polished 95% species identification, which is a direct trust failure on the core product surface. This needs a narrow guard now so obvious non-frog or too-low-signal clips abstain before they can be shown, saved, or fed back as valid observations.

## What Changes

- Add a browser-side trust guard that can reject clips that are too short or too low-signal for a credible frog identification.
- Render a neutral abstention result when the guard trips instead of showing a confident species card.
- Skip observation persistence and per-result feedback UI for abstained clips.

## Capabilities

### New Capabilities
- `classification-trust-guard`: Browser classification abstains on obvious non-frog or too-low-signal clips before a confident result is rendered or stored.

### Modified Capabilities

## Impact

- Affected code: `index.html`, `js/classifier.js`, `js/pages/record.js`, new `js/trust-guard.js`
- Affected systems: browser-only classification and result rendering flow
- Validation: add focused automated coverage for the guard logic and browser verification for silent and obvious non-frog clips
