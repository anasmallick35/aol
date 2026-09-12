# AI Optimization Layer (AOL) — Project Brief & Working Context

**Status:** canonical onboarding doc. Read fully before any planning or development work.
**Last updated:** 2026-09-13

---

## 1. What We're Building

**AI Optimization Layer (AOL)** — an infrastructure layer that sits between AI applications and AI model providers (OpenAI, Claude, Gemini, DeepSeek, Mistral, Grok, Llama, etc.) and automatically reduces AI inference cost while preserving or improving output quality, latency, and developer experience.

We are not building another AI model. We are building the layer applications route their requests through before those requests reach a model provider.

**Positioning:** "Cloudflare for AI inference" — needs sharpening once a wedge is locked, since Cloudflare AI Gateway already occupies similar framing.

### Core Philosophy (non-negotiable)

1. **Never reduce quality.** Cost reduction is always secondary to quality preservation.
2. **Every optimization must be measurable.** No assumptions — benchmark everything.
3. **Every optimization needs evidence** that it reduced cost/tokens/latency while preserving quality, accuracy, context, and user intent.
4. **Trust over savings.** A small saving that costs customer trust is worse than no saving.

### Original Product Scope (v1.0 vision doc — too broad for v1)

Ten independent "engines": Observability, Context Optimization, Prompt Optimization, Memory Optimization, Semantic Cache, Retrieval Optimization, Intelligent Model Router, Response Optimization, Quality Evaluation, Learning Engine — plus a 5-phase roadmap ending in "AI Infrastructure Platform" (marketplace, plugin ecosystem, global infra).

**Key realization:** this is ten products, not one. Building all ten before shipping anything is why "what's our main model" felt undefined. v1 needs a single wedge; the rest becomes an explicit roadmap, not a v1 requirement.

---

## 2. Market Research Findings (as of Aug 2026)

### Competitive landscape

| Player | Position | Implication for us |
| --- | --- | --- |
| **Portkey** | Acquired by Palo Alto Networks (May 2026), folded into Prisma AIRS | Owns the enterprise compliance/governance lane (SOC 2, GDPR, ISO 27001) |
| **Helicone** | Acquired by Mintlify (Mar 2026); cloud in maintenance mode | Self-hosted Rust gateway still strong: ~8ms p50 observability + caching, fully OSS |
| **LiteLLM** | Dominant OSS self-hosted routing (40K+ stars, hundreds of millions of Docker pulls) | Default choice for teams wanting full control, no external dependency |
| **OpenRouter** | Largest catalog (400+ models) | Strong for prototyping; weakens once routing policy and per-customer cost attribution matter |
| **Martian / Not Diamond** | "Cheapest model meeting quality/latency targets per request" | Directly overlaps our Model Router engine. Martian has Accenture distribution |
| **Cloudflare AI Gateway** | Edge caching/rate-limiting/analytics, 350+ models, zero infra | Direct challenge to our own "Cloudflare for AI" framing |

Enterprise compliance certifications (SOC 2, GDPR, ISO 27001) are table stakes for regulated-industry deals, not a differentiator.

### Cost optimization landscape

- Caching → batching → routing is a well-understood playbook, not a moat. Caching first (zero accuracy risk), batching second (~50% guaranteed discount via e.g. OpenAI Batch API), routing last (requires real benchmark work against your own prompt distribution).
- Mature AI cost governance already delivers 30–60% per-inference cost reduction for enterprises moving from unmanaged to governed deployments (Deloitte State of AI 2026).
- **Agentic workloads are the underserved gap.** Agentic workflows can require 5–30x more tokens per task than single-turn chatbot use (Gartner, Mar 2026). Controlling agent behavior — call frequency, context per call, parallel threads, repeat-request detection — is a fundamentally different observability/control problem from single-call FinOps. Most existing gateways were designed around single-turn API calls, not agent loops.
- **Nobody leads with "quality guarantee" as the core product claim.** Competitors treat quality as a dashboard metric, not a gate that blocks unsafe optimizations. Strongest differentiation candidate.

### Working hypothesis on differentiation

**Agentic workload cost governance, with a hard quality-preservation gate.** Avoids head-to-head with LiteLLM/Portkey/Cloudflare on general-purpose gateway features, targets a growing underserved pain point, and leans into the one thing our philosophy uniquely emphasizes.

**This is a hypothesis, not a decision.** It must survive Stage 1 with real evidence and explicit trade-off comparison against the alternatives (context optimization + observability; quality-guaranteed model routing).

---

## 3. Process Plan — Decide, Document, Then Build

Everything is finalized on paper before product code, so that (a) nothing blocks mid-development, (b) the docs onboard any future teammate or AI assistant, (c) the docs double as pitch material.

| Stage | Output | Status |
| --- | --- | --- |
| **0 — Research** | Competitive landscape, market gaps, technical feasibility per engine, pricing precedents | In progress (§2) |
| **1 — Fundamentals Decision Log** | One doc, one section per decision: options, evidence, decision, reasoning | Not started |
| **2 — PRD** | Scoped v1 behavior + explicit non-goals (other engines deferred, not forgotten) | Not started |
| **3 — Architecture Doc** | System diagram, request lifecycle, data flow, tech stack — derived strictly from PRD | Not started |
| **4 — ADRs** | One per consequential, hard-to-reverse technical choice, traceable to a Stage 1 decision | Not started |
| **5 — GitHub Issue Breakdown** | Epics → architecture components, tasks under each; via GitHub issues once ADRs frozen | Not started |
| **6 — Development** | Build against frozen docs using Claude Code | Not started |

**Stage 1 decisions to make:** v1 wedge · ideal customer profile · integration model · quality-evaluation methodology · pricing/value-capture model · build-vs-integrate list · which enterprise-readiness concerns are day-one vs. later.

**Why this order matters:** each stage is a hard input to the next. Architecture written before fundamentals are locked gets rewritten. GitHub issues written before ADRs exist get rewritten. Doing it in order once is cheaper than doing it out of order twice.

---

## 4. Rough Timeline Expectations

- **Stages 0–1** (research + fundamentals): ~1–2 weeks
- **Stages 2–4** (PRD, architecture, ADRs): ~1–2 weeks
- **Stage 5** (GitHub issue breakdown): a few days
- **Stage 6 → working MVP of the wedge:** ~6–10 weeks after planning ends
- **→ solid v1 a normal company can adopt confidently** (two people): ~4–5 months total including planning
- **→ largest-enterprise production bar** (SOC 2, GDPR/ISO 27001, RBAC, audit logs, regional deployment): 12+ additional months, driven by compliance process timelines rather than engineering effort. Later phase, not v1 scope.

**Team:** two people, working together, using Claude Code for the bulk of implementation and task management once docs are frozen.

---

## 5. Status as of This Document

- Original v1.0 vision doc exists — north-star reference, **not** the v1 spec.
- **Stage 0 Round 1 complete** → [01-research-findings.md](01-research-findings.md). It forced a thesis reframe: the cost levers are commoditizing (provider prompt caching is automatic and free; compaction is built into every agent framework), while **verification that an optimization didn't break anything is unowned**. §2 above is superseded where the two disagree.
- **Stage 0 Round 2 outstanding:** primary research — 5–10 conversations with teams running agents in production (the D0 gate).
- **No fundamentals decisions finalized.** Stage 1 scaffolded and evidence-loaded, all decisions still TBD → [02-fundamentals-decision-log.md](02-fundamentals-decision-log.md).
- **Next step:** clear the D0 gate, then close D1.
