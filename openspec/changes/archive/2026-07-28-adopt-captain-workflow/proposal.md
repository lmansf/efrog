## Why

`efrog` is tagged for the captain's workflow outside the repo, but the tree itself does not tell future crews to start with OpenSpec, use `lavish-axi` for visual review, or validate changes through `no-mistakes`. That gap makes the expected loop easy to skip in fresh worktrees and hard to discover from the project alone.

## What Changes

- Commit the generated OpenSpec root and Codex integration so proposals live in-tree.
- Define a new `captain-workflow` capability that specifies proposal-first changes, `lavish-axi` review usage, and `no-mistakes` validation expectations.
- Update repo docs and ignore rules so contributors know where to create `lavish-axi` artifacts, when to use them, and which `no-mistakes` commands to run in a new worktree.
- Preserve existing application behavior and runtime setup; this change only adds workflow scaffolding.

## Capabilities

### New Capabilities

- `captain-workflow`: Defines the repo-local proposal, review, and validation loop for non-trivial changes.

### Modified Capabilities

- None.

## Impact

- Affected files: `openspec/`, `.codex/`, `README.md`, `AGENTS.md`, `.gitignore`
- Affected systems: contributor workflow, change review, worktree setup
- No application runtime, API, or schema changes
