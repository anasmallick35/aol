# AOL — Working Agreement

**Purpose:** the operational decisions that live in conversation and would otherwise be lost. If a session's context is compacted or a new collaborator joins, this is the file that says *how we work*, as opposed to *what we're building*.

---

## Resuming with no memory of the conversation

Read in this order. Everything traces back to evidence in `01`.

1. **[README](../README.md)** — what the product does, in five steps
2. **[00-project-brief](00-project-brief.md)** — origin and **live principles only**. Its product thesis is dead; the banner at the top says which sections are still valid
3. **[05-product-plan](05-product-plan.md)** — the decided product, competitive position, **and the two untested assumptions**
4. **[07-stack-and-architecture-decisions](07-stack-and-architecture-decisions.md)** — the stack and why, including rejected options
5. **[06-implementation-plan](06-implementation-plan.md)** — build sequence, data model, response ladder (§4.5)
6. **[03-decision-debate-log](03-decision-debate-log.md)** — read this before reopening any decision. Threads 1–11 record what was already argued and rejected
7. **GitHub issues** — current state of work; each carries scope, acceptance criteria, and *why*

**`01-research-findings.md` is a reference, not a read-through.** Look up `[Rnn-x]` citations as they appear.

---

## Git and review workflow

- **One PR per issue.** Not per commit. Eight milestones, eight PRs.
- **Branch naming:** `feat/m1-core-daemon`, `feat/m2-claude-code-adapter`
- **PR body references the issue** (`Closes #1`) so it closes on merge
- **Squash merge** — one clean commit per milestone on `main`
- **Anas reviews and merges.** Claude does not merge its own PRs.
- **`main` is never pushed to directly** — the only exception was the initial docs commit into an empty repo.

### Stacked PRs

Our milestones are a near-linear dependency chain, so stacking is normal.

- **Independent work** → branch from `main`
- **Dependent work** → branch from the parent PR's branch, and **set the PR base to that branch, not `main`**. The diff then shows only the new work, and GitHub **auto-retargets the base to `main`** when the parent merges.
- **Maximum stack depth: 2, occasionally 3.** Beyond that, stop and wait for review rather than building on an unreviewed foundation.
- If the parent PR changes in review, rebase the child on the updated parent.

### Reducing conflict surface

The hotspots are the shared files: `package.json`, the normalised event model, and the SQLite schema — every milestone touches them. **Define all three fully in M1** rather than growing them incrementally. After that, milestones mostly add new files (`extract/`, `detect/`, adapters), which is where conflicts don't happen.

---

## Documentation conventions

- **Decisions** go in `02-fundamentals-decision-log.md`. **Reasoning, including rejected options,** goes in `03-decision-debate-log.md`.
- Anything that **re-expands scope** goes through `03` first. That is the standing constraint from Thread 1.
- Every decision cites evidence from `01`, **or states explicitly that it is being made without evidence.**
- Implementation decisions too small for an ADR are recorded **in the PR description**.
- When a doc is superseded, say so at the top and point at the replacement. Do not silently rewrite history.

---

## Repository and visibility

- Repo `anasmallick35/aol` is **private**.
- **Publishing the code at M8 does not mean publishing `docs/`.** The competitive analysis, the honest moat assessment, and the debate log stay private. The public OSS release is a **separate repo** containing code only.
- Licence is MIT for the code, per the open-core split in [05 §6](05-product-plan.md).

---

## Standing reminders

- **Deterministic-first is architectural, not a preference.** An LLM judge may advise; a mechanical rejection always overrides an LLM approval.
- **The matched control window is mandatory** in every detector. It is the step that stops us fooling ourselves, and we are the most motivated observers possible.
- **The core must not import Agent Hooks types.** AGENT-HOOKS is 0.1 and the toolkit is Public Preview.
- **Two assumptions remain untested** ([05 §9](05-product-plan.md)): that compaction damage is mechanically detectable, and that anyone outside this company will pay for proof. They were deprioritised **by decision, not by evidence.** Do not let the docs' confidence read as validation.
