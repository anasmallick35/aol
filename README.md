# AOL — Context Integrity for AI Agents

> Your agent forgets things when it compacts its context, and nobody notices until something breaks. We notice, and we put it back.

**Status:** pre-build. Planning complete, implementation starting.

## What it does

A safety layer that sits around an agent and makes sure it doesn't silently lose what it needed to know.

```
snapshot  →  agent compacts  →  diff  →  repair or block  →  report
```

1. **Snapshot** what matters before a context mutation — stated rules, files touched, errors hit, open tasks.
2. **The agent compacts** using its own mechanism. We never perform it and never block it.
3. **Diff** what survived against what mattered, measured against a matched control window.
4. **Repair** by re-injecting critical dropped items at the pause point — or, where repair is impossible, **block** the later action that would violate a rule the agent forgot.
5. **Report** what was dropped, restored, blocked, and what it cost.

The goal is not compaction that removes nothing — that is a contradiction, since compaction exists because the context is full. The goal is **nothing important removed, and proof of it.**

## Docs

Read in order. Everything traces back to evidence in `01`.

| Doc | What it is |
| --- | --- |
| [00-project-brief.md](docs/00-project-brief.md) | Onboarding context. Read first. |
| [01-research-findings.md](docs/01-research-findings.md) | Stage 0 research, Rounds 1–5, every claim sourced |
| [02-fundamentals-decision-log.md](docs/02-fundamentals-decision-log.md) | D0–D7: what we decided |
| [03-decision-debate-log.md](docs/03-decision-debate-log.md) | Threads 1–11: **how** we decided, including what we rejected |
| [04-experiment-01-compaction-detectability.md](docs/04-experiment-01-compaction-detectability.md) | Detectability experiment (deprioritised by decision, not evidence) |
| [05-product-plan.md](docs/05-product-plan.md) | The product, the wedge, competitive position, open assumptions |
| [06-implementation-plan.md](docs/06-implementation-plan.md) | Build sequence, repo shape, data model, milestones |
| [07-stack-and-architecture-decisions.md](docs/07-stack-and-architecture-decisions.md) | Every stack/architecture decision with rejected alternatives |
| [08-working-agreement.md](docs/08-working-agreement.md) | How we work: git/PR workflow, doc conventions, **how to resume with no memory of the conversation** |

## Working agreement

See [08-working-agreement.md](docs/08-working-agreement.md). In short:

- Every decision cites evidence from `01`, or says explicitly that it is being made without evidence.
- Decisions go in `02`. The reasoning trail — including what we argued about and rejected — goes in `03`.
- Anything re-expanding scope goes through `03` first.
- One PR per issue; Anas reviews and merges; `main` is never pushed to directly.

## Two untested assumptions

Recorded openly in [05 §9](docs/05-product-plan.md):

1. **Compaction damage is mechanically detectable.** If false, there is no product.
2. **Someone outside this company will pay for proof.** Untested.

Both were deprioritised deliberately to start building. They remain true risks, not resolved questions.
