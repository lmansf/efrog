## Context

`efrog` already has useful runtime and architecture documentation in `README.md` and `AGENTS.md`, but it does not have repo-visible workflow guidance for the captain's loop. `no-mistakes` is healthy on this machine, yet `no-mistakes status` in this disposable worktree reports the repo as uninitialized, which means crews cannot rely on fleet metadata alone. OpenSpec also had no root in the repo before this change, so proposal-first work was not durable.

## Goals / Non-Goals

**Goals:**

- Make OpenSpec the discoverable source of truth for non-trivial workflow proposals in this repo.
- Document when to use `lavish-axi` and where its local artifacts belong.
- Make `no-mistakes` usage explicit for fresh worktrees without adding extra ceremony.

**Non-Goals:**

- Adding CI jobs, wrapper scripts, or new release automation
- Changing browser, server, or iOS product behavior
- Forcing `lavish-axi` artifacts into version control

## Decisions

- Commit the generated `openspec/` root and `.codex/` skill scaffold.
  Rationale: a proposal-first workflow is not real until the repo contains the OpenSpec root and agent entry points.
  Alternative considered: document OpenSpec in `README.md` only. Rejected because crews would still lack a canonical in-tree spec location.

- Define one new `captain-workflow` capability and mirror it in `README.md` and `AGENTS.md`.
  Rationale: one cohesive capability keeps the change proportional and ties the docs back to a normative spec.
  Alternative considered: split the workflow into separate capabilities per tool. Rejected because the tools are only useful as one loop here.

- Treat `.lavish/` as the default local review-artifact directory and ignore it in git.
  Rationale: contributors need a stable place to build review surfaces without polluting commits.
  Alternative considered: commit sample artifacts. Rejected because generated review HTML is ephemeral unless a task explicitly wants it versioned.

- Document `no-mistakes doctor`, `status`, `init`, and `axi run` instead of inventing repo wrappers.
  Rationale: crews need the real commands and gate flow, especially when worktree state differs from project registry state.
  Alternative considered: add wrapper scripts. Rejected because wrappers would hide tool prompts and add maintenance overhead.

## Risks / Trade-offs

- [Some workflow state lives outside the repo] -> Mitigation: document exact worktree checks and commands instead of assuming global/project metadata is enough.
- [Process docs can drift from tool behavior] -> Mitigation: keep the OpenSpec capability as the normative contract and update docs through future OpenSpec changes.
