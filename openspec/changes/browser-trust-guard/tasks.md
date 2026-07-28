## 1. Spec And Guard Setup

- [x] 1.1 Add the OpenSpec proposal, design, and trust-guard capability spec for browser abstention
- [x] 1.2 Add a browser trust-guard owner with signal-summary and abstention evaluation helpers

## 2. Product Flow Integration

- [x] 2.1 Expose decoded-audio signal stats from the browser classifier result
- [x] 2.2 Apply the guard before result rendering and skip storage / feedback when it abstains

## 3. Validation

- [x] 3.1 Add focused automated coverage for silence, short clips, and allowed low-confidence behavior
- [x] 3.2 Verify the user-visible browser result for a silent clip and an obvious non-frog tone
