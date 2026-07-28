## ADDED Requirements

### Requirement: OpenSpec governs non-trivial changes

The repository SHALL keep an `openspec/` root and documented contributor guidance that tells crews to create or update an OpenSpec change before starting a non-trivial implementation, workflow, or architecture change.

#### Scenario: Contributor starts a non-trivial change

- **WHEN** a contributor reads the repo workflow guidance before implementing a non-trivial change
- **THEN** the guidance points to `openspec/` and shows how to create or continue a named OpenSpec change before editing project files

### Requirement: Lavish review is part of the review loop

The repository SHALL document `lavish-axi` as the review surface for browser UI changes, iOS UI changes, and non-trivial plans or implementation results that are easier to review visually than in plain prose. The documented workflow SHALL define `.lavish/` as the default local artifact directory for these generated review surfaces.

#### Scenario: Contributor needs visual review

- **WHEN** a contributor prepares a UI change or a non-trivial plan for review
- **THEN** the repo guidance tells them to build an HTML artifact in `.lavish/`, open it with `lavish-axi`, and use that surface to share or collect review feedback

### Requirement: No-mistakes gates change validation

The repository SHALL document `no-mistakes` as the validation gate before final handoff or shipping, including checking `no-mistakes doctor`, verifying `no-mistakes status` in the current worktree, initializing with `no-mistakes init` when needed, and running `no-mistakes axi run` or attaching to its gate flow before completion.

#### Scenario: Contributor validates a ready branch

- **WHEN** a contributor is ready to hand off or ship a change branch
- **THEN** the repo guidance directs them through the `no-mistakes` worktree checks and gate flow instead of bypassing validation
