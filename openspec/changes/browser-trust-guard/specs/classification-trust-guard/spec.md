## ADDED Requirements

### Requirement: Low-signal clips abstain before identification
The browser classification flow SHALL abstain when the analyzed clip is too short or too low-signal to support a credible frog identification.

#### Scenario: Silent upload
- **WHEN** a user analyzes a silent or near-silent clip
- **THEN** the browser SHALL return an abstained result instead of a confident species identification

#### Scenario: Too-short recording
- **WHEN** a user analyzes a clip shorter than the minimum supported signal window
- **THEN** the browser SHALL return an abstained result instead of promoting a species card

#### Scenario: Long upload whose analyzed window is silent
- **WHEN** a user analyzes a clip longer than the model's clip length whose leading analyzed window is silent or near-silent
- **THEN** the browser SHALL judge signal quality over the same truncated window that is fed to the model and SHALL return an abstained result, regardless of signal later in the clip

### Requirement: The trust guard fails closed
The browser classification flow SHALL NOT produce a confident species identification when the trust guard is unavailable.

#### Scenario: Trust guard script fails to load
- **WHEN** browser-side classification runs without a loaded trust guard
- **THEN** the app SHALL surface an error or an abstained result and SHALL NOT render or persist a confident species card

### Requirement: Abstained results use neutral UI and skip persistence
When the trust guard abstains, the Analyze page SHALL render neutral guidance and SHALL NOT save or solicit feedback for a species observation.

#### Scenario: Abstained result panel
- **WHEN** the trust guard abstains
- **THEN** the result panel SHALL say `No frog call confidently detected` and SHALL explain that the clip did not contain enough usable frog-call signal

#### Scenario: Abstained result is not stored
- **WHEN** the trust guard abstains
- **THEN** the app SHALL NOT create a history entry, local observation row, Supabase observation write, or per-result accuracy prompt for that clip
