# AOL — Origin Brief & Principles

> **⚠️ PARTLY SUPERSEDED. Do not read this as a description of the product.**
>
> This is the **origin document**. It records where the project started, the principles that still govern it, and the process we still follow. Its **product thesis was killed by evidence** in Round 4 of Stage 0 research (see [03 Thread 10](03-decision-debate-log.md)).
>
> | Section | Status |
> | --- | --- |
> | §1 Philosophy | ✅ **Live** — unchanged and non-negotiable |
> | §1 Product scope ("ten engines", "AI Optimization Layer") | ❌ **Dead** — see [05-product-plan.md](05-product-plan.md) |
> | §2 Market research | ❌ **Superseded** by [01-research-findings.md](01-research-findings.md), Rounds 1–5 |
> | §3 Process plan | ✅ **Live** — still how we work |
> | §4 Timeline | ❌ **Superseded** by [06 §5](06-implementation-plan.md) |
> | §5 Status | ❌ **Superseded** by [08-working-agreement.md](08-working-agreement.md) |
>
> **What we are actually building:** a context-integrity layer for AI agents — snapshot what matters before compaction, diff what survived, repair or block, report. Read [05-product-plan.md](05-product-plan.md).
>
> Kept rather than deleted because [03-decision-debate-log.md](03-decision-debate-log.md) references it throughout — Threads 1, 2 and 10 are arguments *against* what is written here, and deleting it would leave that reasoning pointing at nothing.

**Last updated:** 2026-09-13

---

## 1. Where This Started

The project began as an **"AI Optimization Layer"** — infrastructure sitting between AI applications and model providers, automatically reducing inference cost while preserving quality.

**That thesis is dead.** Round 4 found token prices had fallen ~80% in 2026 and ~1,000× in three years, with five independent forces commoditising every cost lever we would have sold. Cost reduction is now a *feature that earns trust*, never the product. Full argument in [03 Thread 10](03-decision-debate-log.md); evidence in [01 R17](01-research-findings.md).

The original scope described **ten independent engines** — Observability, Context Optimization, Prompt Optimization, Memory Optimization, Semantic Cache, Retrieval Optimization, Intelligent Model Router, Response Optimization, Quality Evaluation, Learning Engine — plus a five-phase roadmap ending in a platform and marketplace.

**The realisation that started everything else:** that is ten products, not one. Building all ten before shipping anything is why "what is our main model" felt undefined. This became the standing scope constraint in [03 Thread 1](03-decision-debate-log.md) — **any proposal that re-expands scope has to answer to it.**

### Core Philosophy — LIVE, non-negotiable

These survived every revision and still govern the product:

1. **Never reduce quality.** Cost reduction is always secondary to quality preservation.
2. **Every optimization must be measurable.** No assumptions — benchmark everything.
3. **Every optimization needs evidence** that it preserved quality, accuracy, context and user intent.
4. **Trust over savings.** A small saving that costs customer trust is worse than no saving.

Principle 3 is why [01-research-findings.md](01-research-findings.md) exists and why every decision cites it. Principle 4 is why the gate is deterministic and customer-auditable rather than an LLM judge grading our own work.

---

## 2. Market Research — SUPERSEDED

The original competitive scan (Portkey→Palo Alto, Helicone→Mintlify, LiteLLM, OpenRouter, Martian/Not Diamond, Cloudflare AI Gateway) was **Round 0**. It has been replaced in full by [01-research-findings.md](01-research-findings.md), which corrected several of its conclusions — notably that the routing lane was *weaker* than assumed, not stronger.

**Do not cite this section.** Cite `01`.

---

## 3. Process Plan — Decide, Document, Then Build

Everything is finalized on paper before product code, so that (a) nothing blocks mid-development, (b) the docs onboard any future teammate or AI assistant, (c) the docs double as pitch material.

| Stage | Output | Status |
| --- | --- | --- |
| **0 — Research** | Competitive landscape, market gaps, technical feasibility, pricing precedents | ✅ Complete — [01](01-research-findings.md), Rounds 1–5 |
| **1 — Fundamentals Decision Log** | One doc, one section per decision: options, evidence, decision, reasoning | ✅ Complete — [02](02-fundamentals-decision-log.md) + [03](03-decision-debate-log.md) |
| **2 — PRD** | Scoped v1 behaviour + explicit non-goals | ✅ Folded into [05](05-product-plan.md) |
| **3 — Architecture Doc** | System diagram, data flow, tech stack | ✅ Complete — [07](07-stack-and-architecture-decisions.md) |
| **4 — ADRs** | One per consequential, hard-to-reverse choice | ✅ Folded into [07](07-stack-and-architecture-decisions.md) |
| **5 — GitHub Issue Breakdown** | Epics → components, tasks under each | ✅ Complete — issues M1–M8 |
| **6 — Development** | Build against frozen docs | ⏳ **Current stage** |

**Stage 1 decisions (all made):** v1 wedge · ideal customer profile · integration model · quality-evaluation methodology · pricing/value-capture · build-vs-integrate · enterprise-readiness sequencing. See [02](02-fundamentals-decision-log.md).

**Why this order matters:** each stage is a hard input to the next. Architecture written before fundamentals are locked gets rewritten. GitHub issues written before ADRs exist get rewritten. Doing it in order once is cheaper than doing it out of order twice.

---

## 4. Rough Timeline Expectations — SUPERSEDED

> Estimates below were scoped to the original ten-engine v1 and do not apply. Current estimates: [06 §5](06-implementation-plan.md) — roughly 4 weeks to a shippable tool with enforcement.


- **Stages 0–1** (research + fundamentals): ~1–2 weeks
- **Stages 2–4** (PRD, architecture, ADRs): ~1–2 weeks
- **Stage 5** (GitHub issue breakdown): a few days
- **Stage 6 → working MVP of the wedge:** ~6–10 weeks after planning ends
- **→ solid v1 a normal company can adopt confidently** (two people): ~4–5 months total including planning
- **→ largest-enterprise production bar** (SOC 2, GDPR/ISO 27001, RBAC, audit logs, regional deployment): 12+ additional months, driven by compliance process timelines rather than engineering effort. Later phase, not v1 scope.

**Team:** two people, working together, using Claude Code for the bulk of implementation and task management once docs are frozen.

---

## 5. Status — SUPERSEDED

> Current state lives in [08-working-agreement.md](08-working-agreement.md) and the GitHub issues. Historical record below.


- Original v1.0 vision doc exists — north-star reference, **not** the v1 spec.
- **Stage 0 Round 1 complete** → [01-research-findings.md](01-research-findings.md). It forced a thesis reframe: the cost levers are commoditizing (provider prompt caching is automatic and free; compaction is built into every agent framework), while **verification that an optimization didn't break anything is unowned**. §2 above is superseded where the two disagree.
- **Stage 0 Round 2 outstanding:** primary research — 5–10 conversations with teams running agents in production (the D0 gate).
- **No fundamentals decisions finalized.** Stage 1 scaffolded and evidence-loaded, all decisions still TBD → [02-fundamentals-decision-log.md](02-fundamentals-decision-log.md).
- **Next step:** clear the D0 gate, then close D1.
