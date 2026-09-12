# AOL — Stage 1: Fundamentals Decision Log

**Status:** PROPOSED-RESOLVED — D1–D7 all have a proposed decision recorded in [05-product-plan.md §5](05-product-plan.md). They close formally when **A1 (compaction damage is mechanically detectable)** is answered by [Experiment 01](04-experiment-01-compaction-detectability.md). Reasoning trail in [03-decision-debate-log.md](03-decision-debate-log.md), Threads 2–10.
**Input:** [00-project-brief.md](00-project-brief.md) · [01-research-findings.md](01-research-findings.md) (Round 1 desk research complete)
**Output:** hard input to Stage 2 (PRD). Nothing downstream gets written until every section here is CLOSED.

A decision is CLOSED only when it has: options considered · evidence cited · the decision · the reasoning · what would make us revisit it.

---

## Dependency order

```
D1  v1 wedge ──────────────┬──> D2  Ideal customer profile ──┬──> D5  Pricing / value capture
                           │                                 │
                           ├──> D3  Integration model ────────┤
                           │                                 │
                           └──> D4  Quality-eval methodology ─┴──> D6  Build vs. integrate
                                                                        │
                                                                        └──> D7  Enterprise-readiness: day-one vs. later
```

D1 is upstream of everything. **D4's feasibility question is now answered (see D4) — it no longer blocks D1.**

---

## D0 — Evidence gate (precondition for closing D1)

Round 1 research is entirely secondary — analyst summaries, vendor content, papers, benchmarks. Enough to rule options *out* and to prove technical feasibility. Not enough to prove anyone will pay.

**Gate: 5–10 conversations with teams running agents in production before D1 closes.** External conversations today: **0**.
**Running in parallel:** [04-experiment-01-compaction-detectability.md](04-experiment-01-compaction-detectability.md) — answers the *technical* precondition (is compaction damage mechanically detectable?) with first-party data, and produces a concrete measured claim to put in front of the people we interview. It does not substitute for question 2.

1. **Do teams know their agents are silently losing context to compaction?** — **CLOSED: yes.** Not on our own say-so: Claude Code auto-compact has dozens of public bug reports [R13-a]; compression is lossy and one-way at ~83% context, with critical information permanently gone after 3–4 cycles [R13-b]; the community independently reinvented the same handoff workaround we did [R13-b]; and the damage is measured academically — reliably-solved tasks become intermittently-solved [R14-a], governance decay reproduces across 7 model families and 4 compaction strategies [R14-b], coding agents erode in 80% of trajectories [R14-c]. See Thread 8.
2. **Would anyone pay for verification alone?** — **OPEN, and now the only thing gating D1.** The one "yes" we have is from a founder about their own idea, which is worth approximately nothing. Needs people outside the company.

Supporting questions: who owns agent cost internally (platform team vs. the team that shipped the agent); what they already tried; whether stranded Portkey (→ Palo Alto) and Helicone (→ maintenance mode) users are actively looking to move.

**Status:** OPEN.

---

## D1 — The v1 wedge

**Round 1 forced a reframe.** The brief's framing — "agents cost too much, we reduce that cost" — is being absorbed by the stack:

- Provider prompt caching is **automatic and free, 90% off cached input, 30–50% off agent-loop cost, zero quality change** [R4-a][R4-b]
- Context compaction is **built into every major agent framework** [R4-c][R4-d]

A pitch of "we cut your agent token bill" now competes with free features the customer already has installed.

What is *not* solved: **every layer is silently mutating agent context to save money — providers cache it, frameworks compact it, gateways cache-hit it — and nobody owns proving the result is still correct.** [R2-b][R2-d][R4-c]

| Option | For | Against | Evidence |
| --- | --- | --- | --- |
| **A. Agentic cost governance** (original hypothesis) | Pain is real and acute: 5–30x tokens/task, 340% QoQ growth, Uber burned its 2026 AI budget by April, "token tsunamis" | The named pain is runaway loops + missing attribution, i.e. **control and visibility**, not token price. And the cost levers are commoditizing | [R1-a][R1-c][R4-a] |
| **A′. Verification layer for agent optimizations** (refined) | Nobody owns it. Compaction erases safety constraints silently; semantic cache false-positive rate ~15% with a bi-encoder; only AutoGen coordinates compaction; no stable standard | Sells a negative ("nothing broke"). Unproven willingness to pay — **this is D0 question 2** | [R2-b][R2-d][R4-c][R5-c] |
| **B. Context optimization + observability** | Clear measurable token reduction | **Rule out.** Observability incumbents are ClickHouse/Langfuse, Braintrust ($800M), Arize (1T spans/mo) in a $2.69B market. Two people cannot win this | [R3-d] |
| **C. Quality-guaranteed model routing** | Strong measured numbers: 85% cost cut at ~95% GPT-4 Turbo quality on MT Bench; public RouterArena leaderboard to prove claims third-party | Hardest lever; last step of the playbook; needs benchmarking against *your own* prompt distribution | [R4-f][R3-c] |

**Correction to the brief:** it ruled out routing because Martian/Not Diamond are strong. Evidence says they are not — Not Diamond ranks **12th of 12 on RouterArena** and "frequently selects expensive models"; Martian's product URL is dead, its site now emphasizes interpretability research, and one evaluation excluded it because it **ignored the user-supplied model list**. [R3-b] Routing should be ruled out for *difficulty*, if at all — not for competitor strength.

**Leading candidate: A′,** with A as its distribution vehicle (governance gets you installed; verification is why they keep paying).

**Decision: TBD — blocked on D0.**
**Reasoning:** _(on close)_ **Revisit if:** _(on close)_

---

## D2 — Ideal customer profile

- **Options:** AI-native startups running agents in prod · mid-market eng teams with a governed AI budget · platform/infra teams in larger orgs · **stranded Portkey/Helicone users** · **teams running coding agents**
- **New candidate — coding agents — with a strong technical argument and a weak commercial one.** For: the deterministic oracle already exists (tests, compiler, type checker, linter), costing near zero and catching **26% of failures LLM-judge baselines miss** [R15-a] — this collapses D4's hardest problem. Against: platform risk (Anthropic owns both Claude Code and its compaction, and is actively improving it [R13-d]); a competitor already occupies the exact shape [R15-b]; and the reachable user is an individual developer, not a platform team with budget [R7-a]. **Proposal: proving ground, not necessarily market.** See Thread 8.
- **Evidence:** typical buyer is a **platform/infrastructure team** owning AI infra, cost control and governance; their stated baseline requirement is that "every request must map to an identity, a budget, and a rate limit, so access can be revoked," with hierarchical budgets and hard blocking limits [R7-a]
- **Open:** does the platform team also own *agent correctness*, or does the team that shipped the agent? The buyer for cost and the buyer for verification may not be the same person — which would make A′ a harder sell than A. **D0 question 3.**
- **Decision: TBD.**

---

## D3 — Integration model

- **Options:** drop-in proxy (base-URL swap) · SDK wrapper · sidecar/library · hybrid (proxy for data plane, SDK for loop instrumentation)
- **Latency is not a constraint — this is a correction.** The actual LLM call takes **50–1000x longer than any gateway overhead**; P99 is dominated by the model, not the proxy [R5-a]. Helicone's ~8ms is not a bar we must hit. **This buys us budget to do real gate work in-path**, which is what makes D4 viable.
- **The hard part stands:** a proxy sees individual calls; loop-level governance needs to know which calls form one task, which are retries, which are parallel branches. OTel `gen_ai.*` agent conventions exist but are **still Development status** (moved to their own repo at v1.42.0, 12 June 2026) [R5-c]. No stable standard to lean on.
- **Enforcement gates effects, not mechanisms (Thread 9).** Verified on Claude Code: `PreCompact`/`PostCompact` **cannot block**, but `PreToolUse` **can** (exit 2). So the loop is capture → diff → **block the violating tool call**, not "prevent the optimization." Better architecture than blocking compaction: it survives vendor changes to *how* compaction works, and generalises past Claude Code.
- **Strong lean:** emit `gen_ai.*` OTel spans regardless of form factor — Datadog LLM Observability, Langfuse and Arize AX/Phoenix ingest them natively [R5-c], so we interoperate with the observability incumbents instead of competing with them.
- **Decision: TBD.**

---

## D4 — Quality-evaluation methodology

**Feasibility question answered: yes, and affordably.** This no longer gates D1.

- **Economics:** judge cost spans 175x, from $0.45/1K to $78.96/1K. A small judge hits **~$1.01/1K evaluations at 96.6% ECR@1 — 78x cheaper than a frontier judge, at better accuracy**. ~80% agreement with human preferences, matching human-to-human consistency. [R2-a] Against a workload burning $400K/year, sampling even 10% of tasks is trivially affordable.
- **But a single judge call is not a gate.** Judges show position bias, verbosity bias and self-preference; and accuracy and reliability are **independent dimensions** — the literature's warning is "reliability without validity," i.e. consistent scores that don't track truth. [R2-a]
- **Cheap non-judge signals exist:** cross-encoder reranking over top-5 ANN candidates lifts cache-hit precision@1 from ~85% to **96–98%**, cutting false-positive hits 60–80%; production cosine thresholds sit at **0.92–0.97** (start 0.95); namespacing is a correctness control, not a feature [R2-b].
- **2026 production pattern is hybrid:** metrics for what's measurable, LLM-judge for what needs reasoning, human review for the failing 1–5% [R2-a].
- **Options:** sync in hot path · async/sampled with rollback · benchmark-at-design-time only · **tiered hybrid (leading)**
- **Decision: TBD** — but the shape is now evidenced: multi-signal, tiered, sampled.

---

## D5 — Pricing / value capture

- **Options:** % of savings · flat platform fee · usage-based · hybrid
- **Precedent:** cloud cost vendors charge **~15% of realized savings** or **~1–2% of total spend**. Pro: no upfront cost, pays for itself. Con: assumes waste exists, and the vendor takes a cut of **gross** savings while the customer bears implementation cost [R6-a].
- **The baseline problem is now evidenced, not just suspected.** Since provider caching delivers 30–50% for free and automatically [R4-a], a customer can fairly ask which savings were *ours*. Any savings-based pricing must define the baseline as **post-provider-cache spend**, or the first renewal is a fight. **Strong argument for spend-based or flat pricing.**
- **If the wedge is A′ (verification), % of savings is incoherent anyway** — verification's value is avoided incidents, not dollars saved.
- **Decision: TBD.**

---

## D6 — Build vs. integrate

- **Never build:** provider prompt caching or batching — the providers do it automatically and free, and duplicating them is negative value [R4-a][R4-b].
- **Integrate, don't build:** provider abstraction/fallback (LiteLLM, 100+ providers [R3-a]) · prompt compression (LLMLingua/LLMLingua-2/LongLLMLingua — up to 20x compression at <2% performance loss, OSS, unclaimed as a product [R4-e]) · router baselines (RouteLLM [R4-f]) · telemetry plumbing (OTel `gen_ai.*` [R5-c]) · embeddings and cache storage.
- **Build only:** whatever the verification gate is — the multi-signal quality decision, the loop-level task model, and the evidence trail. That's the differentiation; everything else is a dependency.
- **Public proof asset:** RouterArena (ICLR 2026) — 8,400 questions, 9 domains, scored on accuracy/cost/optimality/robustness/latency, submit by PR [R3-c]. If we ship routing, this proves the quality claim third-party instead of asserting it.
- **Decision: TBD.**

---

## D7 — Enterprise readiness: designed in vs. bolted on

- **Day-one (expensive to retrofit):** data isolation and **tenancy namespacing** — the documented semantic-cache leak was caused by a global namespace [R2-b], so this is a correctness boundary, not just a compliance one · auditability / immutable request logs · secrets handling · retention controls
- **Later (process-bound):** SSO, SOC 2, GDPR, **ISO/IEC 42001**, EU AI Act conformity, regional deployment, RBAC depth
- **Update to the brief:** procurement in regulated sectors now anchors on **NIST AI RMF, ISO/IEC 42001 and the EU AI Act** alongside SOC 2; Gartner projects AI governance spend **>$1B by 2030** [R7-a].
- **Test:** if getting it wrong means a schema/architecture rewrite, it's day-one. If it's paperwork and config, it's later.
- **Decision: TBD.**

---

## Closed decisions

**D1 — Wedge. CLOSED (Thread 10): context integrity for long-running agents.** Cost reduction demoted to a feature that earns trust and funds the gate, never the pitch. Killed by five independent commoditising forces against a unit price falling 3–5×/year [R17][R4-a][R9-a][R18-d][R21], against an 89% agent-pilot failure rate diagnosed at the runtime layer [R18-a].
**Revisit if:** Experiment 01 hits a kill condition, or D0 conversations rank cost above correctness.

**D2–D7 — proposed and recorded in [05-product-plan.md §5](05-product-plan.md).** Formally closed on A1.
