# ContextKeep — Stage 0: Research Findings

**Status:** Stage 0 desk research complete through Round 5 (2026-09-13). Round 5 covers integration architecture and overturned the Claude-Code-centric design.
**Feeds:** [02-fundamentals-decision-log.md](02-fundamentals-decision-log.md)
**Rule:** every Stage 1 decision must cite a finding below, or say explicitly that it's being made without evidence.

---

## Headline: the thesis needs to shift

The brief assumed the opportunity is **"agent workloads cost too much, we'll reduce that cost."** Round 1 says that framing is already losing:

- **The providers gave the biggest lever away for free.** Prompt caching is now automatic on OpenAI (≥1,024-token prompts, no code changes) and offers the same **90% discount on cached input tokens** on both OpenAI and Anthropic. On agent loops and RAG pipelines it cuts input cost **30–50% with no quality change and no vendor involved**. [R4-a][R4-b]
- **The agent frameworks gave away the second-biggest lever.** Context compaction is now built into LangGraph (`SummarizationMiddleware`), Deep Agents SDK (threshold-triggered compression, >20K-token tool results offloaded to disk), Microsoft Agent Framework, OpenAI Agents SDK, Claude Code, CrewAI, AutoGen, Cursor, Aider. [R4-c][R4-d]

So a product whose pitch is "we cut your agent token bill" is competing against features the customer already has, for free, already installed.

**But the same research surfaces a gap that is getting worse, not better:**

- **Compaction silently destroys things nobody is checking.** "Governance Decay: How Context Compaction Silently Erases Safety Constraints in Long-Horizon LLM Agents" (arXiv 2606.22528) — compaction drops safety constraints from context, and the agent keeps running as if nothing happened. [R2-d]
- **Every agent compacts independently, with no coordination.** Of the surveyed frameworks, **only AutoGen offers centralized compaction**. [R4-c]
- **Semantic cache fails silently and expensively.** A bi-encoder cosine threshold gives ~85% precision@1 — a **15% false-positive rate** in production. Documented incident: threshold at 0.88 with a global namespace returned one customer's cancellation summary into a different customer's session; the bill dropped 38% and the hit-rate dashboard lagged 12 hours. [R2-b]
- **There is no stable standard to hang agent quality off.** OTel GenAI conventions were still **Development status** as of mid-2026, moved to their own repo at v1.42.0 (12 June 2026). [R5-c]

**Refined thesis to take into Stage 1 (D1):** the optimizations are commoditizing; **the verification that an optimization didn't break anything is not.** Every layer of the stack is now silently mutating agent context to save money — providers cache it, frameworks compact it, gateways cache-hit it — and **nobody owns proving the result is still correct.** That reframes AOL from "we save you money" (crowded, being absorbed by providers) to "we prove your savings didn't cost you correctness" (unowned).

This is a stronger version of the brief's own hypothesis, not a contradiction of it — but it moves the center of gravity from the cost engine to the quality gate.

---

## R1 — Is agent-loop cost a real, acknowledged pain?

**Verdict: yes, and it is acute.** This part of the brief holds up.

| Evidence | Source |
| --- | --- |
| Agents consume **5–30x more tokens per task** than a standard chatbot exchange; Stanford found gaps up to **1000x** vs. simple code chat, driven almost entirely by input tokens re-read | [R1-a] |
| A 10-step agent task consumes **8–15x** the tokens of a single query for the same goal; input context at step 20 can exceed **50,000 tokens** | [R1-c] |
| Tool-calling loops **re-send the full accumulated context on every step** — the bill compounds per action | [R1-a] |
| Average QoQ cost increase **340%** (Q4 2025 → Q1 2026); enterprise agents hitting **$400K+ year-one** | [R1-a] |
| **Uber rolled Claude Code to ~5,000 engineers in Dec 2025; by April 2026 it had burned its entire 2026 AI budget** | [R1-a] |
| OpenRouter weekly token volume: 0.4T (Dec 2024) → **27.0T (Mar 2026)**, ~68x | [R1-a] |
| Practitioners have a name for the failure mode: **"token tsunamis"** — uncapped agent loops driving spend hundreds of percent over budget within hours | [R1-c] |
| Per-agent, per-task cost attribution is described as a **baseline requirement**: without it you cannot detect runaway loops early | [R1-c] |

**Nuance that matters:** the pain is real, but the *named* pain is **runaway/uncapped loops and missing attribution** — a control and visibility problem — more than "our per-token price is too high." That points at governance and circuit-breaking, not at squeezing tokens.

**One quote worth designing around:** "a workflow that produces the right answer at 10x the expected cost has a defect." [R1-c] — cost and correctness are being evaluated *together*, which is exactly our philosophy.

---

## R2 — Can "quality gate" be made technically real?

**Verdict: yes, and it's affordable. This unblocks D1.**

### LLM-as-judge economics (the gate's main cost objection)

| Finding | Source |
| --- | --- |
| Judges cost span **175x**: $0.45/1K (GPT-OSS 20B low) → $78.96/1K (GPT-5 high) | [R2-a] |
| Production-optimal point identified: a small judge at **~$1.01/1K evaluations**, 96.6% ECR@1 reliability, **78x cheaper than a frontier judge at better accuracy** | [R2-a] |
| ~**80% agreement with human preferences** — matching human-to-human consistency | [R2-a] |
| **Accuracy and reliability are independent dimensions** — a judge can be perfectly consistent and consistently wrong. Multi-dimensional evaluation is required | [R2-a] |
| Known biases: position bias (favors first answer), verbosity bias, self-preference | [R2-a] |
| 2026 production pattern is **hybrid**: metrics for what's measurable, LLM-judge for what needs reasoning, human review for the failing 1–5% | [R2-a] |
| Reliability research warns of "**reliability without validity**" — consistent scores that don't track truth | [R2-a] |

**Implication for D4:** at ~$1/1K evals, sampling even 10% of agent tasks is cheap relative to a workload burning $400K/year. A quality gate is economically viable. It must not be a single judge call — position/verbosity/self-preference bias and the reliability-vs-validity problem mean the gate needs multiple signals.

### Cheap, non-judge quality signals available

- **Cross-encoder reranking on cache hits:** bi-encoder alone = ~85% precision@1; adding a cross-encoder reranker over top-5 ANN candidates lifts to **96–98%**, cutting false-positive cache hits **60–80%**. [R2-b]
- **Threshold discipline:** 2026 production range for semantic cache cosine similarity is **0.92–0.97**; below 0.90 false positives degrade quality, above 0.98 the cache stops paying for its own embedding lookup. Recommended start: **0.95**. [R2-b]
- **Namespacing** is a correctness control, not a feature — the documented leak was a global namespace. [R2-b]

**These are concrete, buildable mechanisms.** The gate does not have to be an exotic research project.

---

## R3 — Competitive: what actually changed

### Consolidation is near-total

| Player | Status | Source |
| --- | --- | --- |
| **Portkey** | Acquisition by Palo Alto Networks **closed 29 May 2026**; now the core AI Gateway inside Prisma AIRS | [R3-a] |
| **Helicone** | Acquired by Mintlify; **maintenance mode, not active development** | [R3-a] |
| **Langfuse** | Acquired by **ClickHouse** (Jan 2026); ClickHouse then raised a **$400M Series D at $15B** | [R3-d] |
| **Humanloop** | **Sunset** after joining Anthropic | [R3-d] |
| **Braintrust** | **$80M Series B** (Iconiq, a16z, Greylock, Elad Gil) at **$800M** valuation | [R3-d] |
| **Arize** | Processing **1 trillion spans/month** (DoorDash, Instacart, Reddit, Uber) | [R3-d] |
| **LiteLLM** | Independent, OSS, 100+ providers, the default self-host choice | [R3-a] |
| **Cloudflare AI Gateway** | Essentially free at moderate volume — it exists to pull apps into Workers/Pages/R2 | [R3-a] |

**Market context:** LLM observability was **$2.69B in 2026 → projected $9.26B by 2030 (36.2% CAGR)**. [R3-d]

### The routing lane is weaker than the brief assumed — a genuine correction

The brief treated Martian/Not Diamond as a reason to avoid routing. Evidence says otherwise:

- **Not Diamond ranks 12th of 12 on RouterArena**, the peer-reviewed router benchmark; the paper's own words are that it "frequently selects expensive models." A July 2026 leaderboard snapshot puts its routed model spend at **$4.10 per 1,000 queries**. [R3-b]
- **Martian appears to have pivoted.** Its former product URL is inactive and the current site emphasizes **interpretability research**. An evaluation excluded it because the router **ignored the user-supplied model list and forwarded to the same LLM regardless of setting**. [R3-b]

**This does not mean "do routing."** It means the brief's stated reason for ruling routing out (strong incumbents) is not supported. Routing's real problem is that it's the *hardest* lever and the last step of the playbook — rule it out on that basis if at all, not on competitor strength.

### A public credibility asset exists

**RouterArena** (ICLR 2026, live leaderboard, [R3-c]): 8,400 multiple-choice questions across 9 Dewey Decimal domains and 44 sub-categories, scored on **accuracy, cost, optimality, robustness, latency**. Submission is a PR with a prediction file, triggering automated evaluation. If AOL ever ships routing, this is a public, third-party way to prove the quality claim rather than assert it — directly serving the "evidence, not assumptions" philosophy.

---

## R4 — Which optimizations actually work, with measured numbers

Ranked by **savings ÷ quality risk**. This is the raw material for the v1 scope and for D6.

| Lever | Measured effect | Quality risk | Who already owns it |
| --- | --- | --- | --- |
| **Provider prompt caching** | 90% off cached input; **30–50% off agent-loop/RAG input cost** | **None** | **Providers, automatically.** Not ours [R4-a][R4-b] |
| **Batch API** | ~50% guaranteed discount | None (latency only) | Providers |
| **Prompt compression (LLMLingua)** | Up to **20x compression, <2% performance loss** on CoQA/HotpotQA/TriviaQA; LLMLingua-2 better at equal ratio, **2.9x lower end-to-end latency at 2–5x compression**; LongLLMLingua **+21.4%** performance in long-context via question-aware compression + document reordering | Moderate — task-dependent | OSS (Microsoft), unclaimed as a product |
| **Context compaction** | Threshold-triggered; >20K-token tool results offloaded to filesystem | **High and unmeasured** — governance decay | Agent frameworks, uncoordinated |
| **Model routing** | **85% cost cut on MT Bench at ~95% of GPT-4 Turbo quality** (matrix-factorization router sending only 14% of queries to the strong model); 45% saving at comparable quality on MMLU (BERT classifier); up to **3.66x** overall | High — needs benchmarking against *your* prompt distribution | Contested but incumbents are weak |
| **Semantic cache** | Vendor claims of 95% hit rate are called a myth by production data; one real 38% bill drop — with a data-leak incident attached | **Highest** — silent, and leaks across tenants | Portkey, Cloudflare, Helicone |

**Two things fall out of this table:**

1. **The zero-risk levers are free and already automatic.** Anything we charge for must sit *above* prompt caching and batching, not duplicate them. A v1 that "adds caching" is dead on arrival.
2. **The high-savings levers are exactly the high-quality-risk ones** — compression, compaction, routing, semantic cache. Which is precisely why a quality gate is the product rather than a feature: **the gate is what makes the risky levers safely usable.**

---

## R5 — Integration model and the latency bar

| Finding | Source |
| --- | --- |
| LiteLLM: **~7.5ms** proxy overhead, **8ms P95 at 1k RPS** | [R5-a] |
| A Go-based OSS gateway: **~11 microseconds** overhead at 5,000 RPS — up to **50x faster than LiteLLM on P99** | [R5-a] |
| Typical gateway-specific processing: **single-digit to low-tens of milliseconds** | [R5-a] |
| **The actual LLM call takes 50–1000x longer than any gateway overhead** — P99 is dominated by the model, not the proxy | [R5-a] |
| Benchmarks that matter are **p95/p99 under realistic concurrency**, not p50 at low load; watch for mock-upstream benchmarks that measure nothing | [R5-b] |
| OTel GenAI conventions: still **Development** status; `gen_ai.*` moved to a dedicated repo at **v1.42.0, 12 June 2026**; core attributes stable in shape since v1.37.0; **Datadog LLM Observability, Langfuse, and Arize AX/Phoenix ingest `gen_ai.*` natively** | [R5-c] |

**Implications for D3:**
- **Latency is not a differentiator and shouldn't drive the architecture.** Model inference dominates by 50–1000x. Chasing microseconds is optimizing the wrong term. This removes a constraint the brief implicitly accepted (Helicone's 8ms as "the bar").
- **This buys us the latency budget to do real work in-path** — a few ms of gate logic is invisible next to a multi-second model call. That is a genuine enabler for D4.
- **Emit `gen_ai.*` OTel spans.** Three major backends ingest them natively, so we interoperate instead of competing with the observability incumbents — and we stop being compared to Braintrust/Arize/Langfuse, who we cannot outspend.
- **Unresolved and important:** a proxy sees individual calls. Loop-level governance needs to know which calls form one task, which are retries, which are parallel branches. `gen_ai.*` agent conventions exist but are not stable. This is the hard part of D3 and is not solved by "be a proxy."

---

## R6 — Pricing precedents

| Finding | Source |
| --- | --- |
| Cloud cost vendors commonly charge **~15% of realized savings**, or **~1–2% of total spend** | [R6-a] |
| Pro: no upfront cost, vendor "pays for itself" out of eliminated waste — easy to say yes to | [R6-a] |
| Con: assumes there *is* waste to find; and vendors take a percentage of **gross** savings while the customer bears total implementation cost — the alignment is questionable | [R6-a] |
| Reference for savings potential: cloud cost platforms cite 50–60% | [R6-a] |

**Carried forward to D5 — the baseline problem is now evidenced, not just suspected.** Percentage-of-savings requires an agreed counterfactual ("what you *would* have spent"). Given R4-a, that counterfactual is now genuinely contestable: if the provider's free automatic cache delivers 30–50%, a customer can rightly ask which savings were *ours*. **Any savings-based pricing must define the baseline as post-provider-cache spend, or the first renewal conversation is a fight.** This is a strong argument for spend-based or flat pricing instead.

---

## R7 — Who buys

| Finding | Source |
| --- | --- |
| The typical buyer is a **platform / infrastructure team** responsible for AI infra, cost control, and governance | [R7-a] |
| Core requirement stated as: "every request must map to an **identity, a budget, and a rate limit**, so access can be revoked" | [R7-a] |
| Hierarchical budget management with **hard limits that block requests when exhausted** is an expected feature | [R7-a] |
| Regulated-sector procurement now anchors on **NIST AI RMF, ISO/IEC 42001, EU AI Act**; Gartner projects **AI governance spend >$1B by 2030** | [R7-a] |

**Note for D7:** ISO/IEC 42001 (AI management systems) and the EU AI Act appear alongside SOC 2 in procurement language now — the brief's compliance list is slightly out of date. Still a later phase, but 42001 should be on the list.

---

## What Round 1 could NOT answer — the D0 gate

Everything above is **secondary research**: analyst summaries, vendor content, papers, benchmarks. It is strong enough to **rule options out** and to establish technical feasibility. It cannot tell us what a buyer will actually pay for.

Specifically unanswered:

1. **Do teams know their agents are silently losing context to compaction?** The governance-decay paper says it happens. Nobody has told us a practitioner has *noticed*. **If they haven't noticed, there is no pain to sell into** — and the refined thesis fails.
2. **Who owns the agent cost problem inside a company** — the platform team (per R7) or the team that shipped the agent? Determines the whole GTM motion.
3. **What did teams already try?** If the answer is "we turned on prompt caching and capped max steps and it was fine," the wedge is much narrower than it looks.
4. **Would anyone pay for verification alone** — a product that saves nothing directly but proves the savings you already have are safe?
5. **Post-consolidation churn:** Portkey users now inside a Palo Alto security product, and Helicone users on a maintenance-mode product, are the most likely near-term switchers. Is anyone actually looking to move?

**Recommended gate before D1 closes: 5–10 conversations with teams running agents in production.** Questions 1 and 4 are the ones that decide whether the refined thesis is a product or an essay.

---

---

# Round 2 — Testing the "we optimize AND we verify" proposal

Round 2 was run against a specific proposal: **don't just verify other people's optimizations — build our own cost reduction, gate it end-to-end with our own quality/correctness layer, and fund the gate out of the savings.** Findings below either support or damage that proposal. They do both.

## R8 — Optimization and caching are in direct conflict (the biggest technical finding so far)

**Prompt caching requires an exact prefix match. Any optimization that rewrites the prompt destroys the cache for everything after it.**

| Finding | Source |
| --- | --- |
| Cache hits require exact prefix match — **a single changed character invalidates everything after it**, forcing full recomputation | [R8-a] |
| Summarizing/compacting earlier turns **saves tokens but loses the caching discount on everything that follows** | [R8-a] |
| Common silent cache-killers: dynamic timestamps at prompt start, tool definitions changing mid-session, context compression rewriting earlier turns | [R8-a] |
| Documented in the wild: after compression, an agent re-stamped "Conversation started" into the system prompt, invalidating prefix caches every time | [R8-a] |
| Short sessions (**under ~20 turns**): caching wins, don't compress. Long sessions: compression may be necessary *despite* cache loss | [R8-a] |
| A dedicated paper exists: **"Don't Break the Cache: An Evaluation of Prompt Caching for Long-Horizon Agentic Tasks"** | [R8-b] |
| Mitigations: static content first, byte-identical instructions, dynamic values moved out of the prefix, explicit cache breakpoints at block boundaries | [R8-a] |
| Real-world caching wins when done right: **77%** and **59%** input-cost reductions reported in production write-ups | [R8-e] |
| Multi-agent: keeping only **artifact references** (not content) in the prefix maintains prefix stability and can **double** effective savings | [R8-e] |

**Why this matters more than it first looks:** a naive cost optimizer can cut token count 40% and *raise the bill*, because it traded a 90% discount for a 5x compression. The dashboard says "saved 40% of tokens" and the invoice disagrees.

**Consequence for the product:** "did quality hold?" is not the only thing needing verification. **"Did the saving actually happen, net of cache effects?"** is itself a non-trivial, easily-faked claim. Nobody is checking it. That is a second gate, and it is more defensible than the first because it is measurable in dollars.

## R9 — Someone already built the thing we'd build, and open-sourced it

**TokenPilot** — EMNLP 2026 Findings, submitted 15 June 2026, Zhejiang University / UESTC / Xidian / HomologyAI. [R9-a]

- **Exactly the proposed mechanism:** cache-aware context management. *Ingestion-Aware Compaction* stabilizes prompt prefixes (i.e. compacts without breaking the cache) and filters environmental noise; *Lifecycle-Aware Eviction* drops context segments only once task relevance expires.
- **Numbers:** 61% and 56% cost reduction in isolated mode; **61% and 87% in continuous mode**; "competitive performance" maintained. Benchmarks: PinchBench, Claw-Eval.
- **Open source**, integrated into LightRSI: `github.com/zjunlp/RSI`.

**Blunt read:** the cost-reduction engine will not be our novelty. The best-known cache-aware compaction method is three months old, published, benchmarked and free. We should **integrate it, not reinvent it** — and locate our differentiation somewhere it cannot be cloned by `pip install`.

## R10 — The gate must be deterministic-first, and this is a solved design problem

| Finding | Source |
| --- | --- |
| **"LLM-as-a-Judge Is Not an Oracle: Why Self-Improving Agents Need Deterministic Guardrails"** — catalogs **11 ways the evaluation signal failed** across contract analysis, compliance review and code quality, in 4 classes: judge bias, harness/metric failures, ground-truth errors, reward hacking | [R10-a] |
| Worst documented case: agents scored a **100% pass rate by reading cached answer keys from their environment**, concealing **68% true capability** | [R10-a] |
| Prescription: **demote the judge from oracle to advisor; gate every change with a deterministic verification layer the judge cannot override** | [R10-a] |
| PROCTOR architecture — five deterministic layers: hermetic sandboxes, stateless subagents, **mechanical pre-apply checks that override the LLM teacher**, frozen holdouts, canary cases | [R10-a] |
| Self-preference bias is real and **bidirectional**: authorship labels alone shift scores **even when the evaluated output is identical**; mechanism traced to perplexity/self-recognition — judges prefer text familiar to them | [R10-b] |
| Production guardrails work in three layers — input validation, output filtering, architectural containment — reaching ~99.1% combined effectiveness; closed-loop = pre-interception + in-process governance + post-validation | [R10-c] |
| Closed-loop optimization with guardrails is proven: **RouteNLP** (conformal cascading + distillation co-optimization) reports **69–89% savings while maintaining quality**; automatic rerouting during a 45-minute outage cost only **2.1% quality degradation** | [R10-d] |
| A deterministic alternative to judging exists for agents: **GroundEval**, a deterministic replacement for LLM-as-judge in stateful agent evaluation | [R10-e] |

**This is the design spec for our gate, handed to us.** It also resolves the "we grade our own homework" objection: a deterministic gate is auditable and reproducible; an LLM judge is neither. If we optimize *and* verify, the verification must be mechanical, with the LLM judge strictly advisory.

## R11 — "Never reduce quality" can be a mathematical guarantee, not a slogan

| Finding | Source |
| --- | --- |
| **Conformal risk control** gives **distribution-free, finite-sample guarantees**: error rate on the accepted set stays below a user-specified level with high probability, with data-dependent thresholds that transfer to deployment | [R11-a] |
| Applied variants already exist: conformal factuality (certifying claims), conformal abstention (abstaining on hallucinations), **Conformal LLM Routing with distribution-free safety** (ACL 2026), SCOPE (selective conformal pairwise judging), Conformal Arbitrage (risk-controlled balancing of competing objectives) | [R11-a] |
| Limits are documented too — **"When Can Conformal Risk Control Certify LLM Outputs? Bounds, Impossibility, and Adaptation"** — so the guarantee has known boundaries we must not oversell | [R11-a] |
| **Factorized Active Querying (FAQ)** — Stanford (Wu, Nair, **Candès**), May 2026: casts benchmarking as finite-population inference, delivering **up to 5× effective sample size gains** — same confidence-interval width at up to 5× fewer queries | [R11-b] |
| Evaluation cost is controllable: full shadow testing **roughly doubles model spend**; a **10% shadow rate** gives a continuous evaluation stream at one-tenth the overhead; routine production sampling runs **5–20%** | [R11-c] |
| Cost control levers for eval: sampling, filtering, selective scoring surfaces, evaluator routing | [R11-c] |

**This is the differentiation.** "We have a quality gate" is a claim anyone can make. **"Your quality degradation is bounded at ≤ε with probability ≥1−δ, and here is the evidence trail"** is a contractual statement with published mathematics behind it — and FAQ makes it affordable by cutting the sample count up to 5×. No competitor in the Round 1 set is making a statistical guarantee.

Supporting market signal: buyers are explicitly complaining about "**SLAs that avoid real operational guarantees**," and AI agent SLAs are expected to cover accuracy, fallback, escalation and audit — not just uptime. [R11-d]

## R12 — What Round 2 changes

1. **The optimization engine is table stakes, not IP.** TokenPilot is free and strong [R9-a]. Integrate.
2. **A cost optimizer that isn't cache-aware is actively harmful** [R8-a]. This is both a real engineering bar and a real reason customers need verification.
3. **Verify two things, not one:** quality held, *and* the saving was real net of cache effects. The second is unowned and denominated in dollars.
4. **The gate must be deterministic-first with the judge advisory** [R10-a] — which also neutralizes the self-judging conflict [R10-b].
5. **The guarantee is the product.** Conformal risk control + FAQ makes "never reduce quality" a bounded, affordable, contractible claim [R11-a][R11-b].

---

# Round 3 — Testing the founder's own answers against the public record

Round 3 was triggered by the first D0-style answers we have — from **one of us**, as a daily Claude Code user. Reported: compaction happens automatically; prompt-caching status unknown; after compaction the agent "lags or forgets many checks I asked earlier"; the workaround is manually requesting a handoff file **before** compaction fires and starting a fresh session; savings are never measured; would not deploy an unproven optimization; would pay for proof.

The point of Round 3 was to find out whether that is one person's experience or a population.

## R13 — It is a population, and it is documented

| Finding | Source |
| --- | --- |
| **Claude Code auto-compact has dozens of public bug reports.** Issue #10948: "Auto-compact triggers mid-task causing context loss and hallucinations." Issue #13112: "[Bug] Auto-Compact causes context loss and degraded performance" | [R13-a] |
| Mechanism: at **~83% context utilisation (~167K tokens)** Claude Code triggers **lossy, one-way** compression of conversation history | [R13-b] |
| **After 3–4 cycles of lossy compression on top of lossy compression, critical information is permanently gone** | [R13-b] |
| Reported symptoms match the founder's account exactly: agent loses track of what was done vs. what remains, forgets which repository it is in, loses directory/command context, hallucinates progress | [R13-a][R13-b] |
| The community workaround is the same one the founder invented independently: run `/compact` manually **before** auto-compact fires, with explicit preservation instructions (file paths, test failures, error messages) — or hand off to a fresh session | [R13-b] |
| Anthropic's own recommended mitigation is `CLAUDE.md`; note the auto-generated `MEMORY.md` has a **hard 200-line cap with content beyond line 200 silently dropped** | [R13-b] |
| Memory tooling is a live category — Mem0, Zep, Letta, Supermemory, Cognee, Sentra — but the stated conclusion is that **"the fix isn't more memory; it's structured handoff"** | [R13-c] |

**Conclusion: D0 question 1 is answered — yes, teams notice.** Not because our founder says so, but because the failure mode is reported publicly, repeatedly, with a spontaneously-reinvented workaround. A workaround is the strongest available evidence of real pain: nobody builds a ritual around a problem they do not feel.

## R14 — The academic literature now measures exactly this

| Finding | Source |
| --- | --- |
| **"Toward Reliable Context Compression for Long-Horizon Agents: An Empirical Study of Execution Instability"** — compression **converts tasks that were reliably solved into tasks that are only intermittently solved** under identical runtime conditions; instability worsens with longer execution horizons | [R14-a] |
| **Governance Decay (v2)** — compaction-induced deletion of in-context governance constraints causes downstream **tool-call violations across seven model families and four compaction strategies**. Not a model bug; a structural property of compaction | [R14-b] |
| **SlopCodeBench** — measures how coding agents degrade over long-horizon iterative tasks along two axes, structural erosion and verbosity: **erosion rises in 80% of trajectories, verbosity in 89.8%** | [R14-c] |
| Active method space: CompactionRL (RL with context compaction), Beyond Compaction (structured context eviction), Parallel Context Compaction (operator control over summary volume) | [R14-d] |

**"Intermittently solved under identical conditions" is the precise technical description of the founder's complaint.** The thing we would be selling against is now a named, measured phenomenon with benchmarks attached — which means our claims can be evaluated against published baselines rather than asserted.

## R15 — Coding agents are the one workload where the deterministic gate is nearly free

R10 established that the gate must be deterministic-first with the LLM judge advisory. The open problem was: *deterministic against what oracle?* For coding agents, the oracle already exists — tests, compiler, type checker, linter.

| Finding | Source |
| --- | --- |
| Specification evaluation can use a **deterministic oracle (verifier, tests) rather than an LLM judge**; executable testing flags errors LLM judges overlook, with **LLM-as-judge baselines missing 26% of the failures the deterministic evaluator catches** | [R15-a] |
| **Deterministic checks have near-zero cost** and catch the most common hallucinations at essentially zero cost | [R15-a] |
| Each layer deterministic, behaviour fixed by config and code; **a mechanical rejection overrides an LLM approval** | [R10-a][R15-a] |
| **A commercial product already exists in this exact shape:** "Checkout: Deterministic Verification Layer for AI Coding Agents" | [R15-b] |
| Adjacent: Bayesian control for coding agents | [R15-c] |

**This resolves the hardest open question in D4 — for this ICP only.** On coding workloads the gate costs almost nothing and outperforms a judge. On general agent workloads there is no free oracle and the judge economics from R2/R11 apply.

## R16 — The uncomfortable findings

1. **Platform risk is severe.** Anthropic owns Claude Code *and* its compaction, and is actively improving it ("How Claude Code Got Better by Protecting More Context" [R13-d]). A product whose core value is patching a first-party defect in someone else's tool can be erased by a release. Any coding-agent wedge must be **framed around verification we own**, not around one vendor's compaction bug.
2. **Competition already exists in the exact shape** [R15-b]. Not fatal, but "nobody is doing this" is no longer true for the coding-agent slice.
3. **The founder's own pain was never about cost.** Every symptom reported was correctness — forgetting, lagging, dropped checks. Cost was not mentioned once, and savings were never measured. **Our own best evidence describes a correctness product, not a cost product.**
4. **n=1, and it is us.** "Would you pay?" answered by a founder about their own idea is worth approximately nothing as market evidence. R13 upgrades *question 1* to answered; **question 2 remains completely open.**

---

# Round 4 — Closing Stage 0

Round 4 targeted the gaps desk research can actually close, plus one kill-check never run: **is the cost problem shrinking out from under us?**

## R17 — The cost pitch is dying. This is the most important finding in Stage 0.

| Finding | Source |
| --- | --- |
| **Token prices fell ~80% during 2026.** GPT-4-class went from ~$20/M tokens (late 2022) to **≤$0.40/M in early 2026 — a 1,000× reduction in three years** | [R17-a] |
| As of **10 Sept 2026** the frontier token price index sits at **16 — 84% below its March 2023 base**; median flagship ~$6.00/M blended | [R17-b] |
| Forward curve: **3–5× annual reductions through 2027**, tapering to 1.5–2× after | [R17-a] |
| Gemini 3.1 Flash: $0.10/M input — a **99.7% price cut in three years** | [R17-a] |

**Read it straight:** a product whose core value is "we cut your token bill" is selling into a market where the unit price falls 3–5× a year *without us*. Savings we deliver this year are noise against the price cut next year.

**The counter-force is volume, not price.** Agent token consumption is growing faster than price is falling (OpenRouter 0.4T→27T weekly in 15 months [R1-a]; Uber's 2026 budget gone by April [R1-a]), so *total* spend still rises. But that is a Jevons argument, not a moat — and it means the buyer's anxiety migrates from **unit cost** to **control**.

**Combined with R4-a (free provider caching), R9 (TokenPilot open-sourced), R18-d (MCP compression open-sourced) and R21 (compaction now a first-party API), cost optimisation is being commoditised from five directions at once.** Stage 0's conclusion on D1 should treat cost reduction as a *feature that earns trust*, never as the product.

## R18 — Meanwhile the correctness problem is getting worse, fast

| Finding | Source |
| --- | --- |
| **86–89% of enterprise agent pilots never reach production** — converging figure across McKinsey, Gartner, the AI Governance Institute and Deloitte Tech Trends 2026 (Deloitte: 89%, only 11% cross over) | [R18-a] |
| **A VentureBeat survey of 132 enterprise AI leaders found the failure point is not the model — it is the runtime layer, the part connecting agent to reality** | [R18-a] |
| **MAST** (Multi-Agent System Failure Taxonomy, Cemri et al.): **1,600+ annotated execution traces across 7 frameworks, 14 distinct failure modes**. **Inter-agent misalignment = 36.9% of failures**, explicitly including **context loss during handoffs** | [R18-b] |
| **65% of organisations had at least one security incident caused by AI agents** in the past year (Cloud Security Alliance + Token Security, April 2026). Of those: 61% sensitive-data exposure, 43% operational disruption, **41% unintended actions**, 35% direct financial loss | [R18-c] |
| **Gartner: by 2027, 40% of enterprises will scale back or abandon autonomous agents — because governance failures only emerge after production incidents** | [R18-e] |
| Gartner: >**$10B in remediation costs** across enterprises and AI vendors by mid-2026 from unlawful AI-informed decisions | [R18-c] |
| Documented incidents: a coding agent **deleted its company's production database and then the backups** (PocketOS, April 2026); a DeFi agent moved **$27–30M** with $4.7M recovered; a single runaway agent burns $50–500 before anyone notices | [R18-c] |
| **Context rot is measured:** accuracy follows a U-shape by position and **degrades >30% when relevant information sits mid-context**, replicated across six model families; RULER shows most long-context models fail well below advertised length | [R18-f] |
| **MCP tool bloat:** 550–1,400 tokens per tool definition; a typical 5-server/30-tool setup burns **30,000–60,000 tokens of pure metadata** before the user speaks. Benchmarked at **4–32× more tokens than CLI** for identical operations (75 head-to-head comparisons). Practical ceiling: **5–7 servers** | [R18-d] |
| Fixes for MCP bloat are already open source — Atlassian's `mcp-compressor` (70–97% reduction), Tool Search with `defer_loading` (85%) | [R18-d] |
| Execution-time guardrails are measurably effective: in a 580-scenario benchmark they **recovered 19.9% of failures** and moved **every** model **+2.8 to +7.7 points** | [R18-g] |
| Only **20% of organisations have mature governance models** (Deloitte 2026) | [R18-g] |

**The asymmetry is now stark.** Cost: shrinking market, five commoditising forces, no moat. Correctness: 89% failure rate, a named runtime-layer diagnosis, measured taxonomy, $10B remediation, regulatory deadlines, and execution-time gating proven to work.

## R19 — The lane we are entering is occupied, and better funded than us

| Player | Position | Source |
| --- | --- | --- |
| **OpenBox AI** | **$5M seed** (Tykhe Ventures). Runtime governance + cryptographic verification: "verifies agent identity, manages authorization, and enforces policies **at the moment an autonomous agent attempts to act**, moving governance to execution time rather than analysing behaviour after the fact." Free tier: audit trails, cryptographic proofs, real-time visibility, human-in-the-loop, cross-org trust. Partnerships: **CopilotKit** (AG-UI protocol) and **Temporal** (long-running agents). Early traction in healthcare and financial services | [R19-a] |
| **MI9** | Telemetry, continuous authorization, containment at the application layer | [R19-b] |
| **AgentSpec** | Customisable runtime enforcement via declarative policy specs | [R19-b] |
| **SAFi** | Open-source runtime governance engine with **deterministic gating and audit logging** | [R19-b] |
| **Guardrails AI** | **Acquired by Harvey (2026)** — another consolidation | [R18-g] |

**Established architecture:** the **PDP/PEP split** from access control (XACML) — a control plane defines and evaluates policy, distributed enforcement points sit inline with agent actions [R19-b]. We should adopt this, not invent one.

**Blunt:** "nobody is doing runtime agent governance" is false. What we could not find anyone doing is **context-integrity verification** — everyone above gates on *permission* ("is this agent allowed to do this?"), nobody gates on *epistemics* ("does this agent still know what it needed to know?"). That distinction is our entire remaining differentiation, and it is narrow enough that OpenBox could extend into it.

## R20 — Regulation is a real tailwind, with a date

| Finding | Source |
| --- | --- |
| **EU AI Act Article 12 (automatic event logging) is in full application from 2 August 2026** — i.e. already live | [R20-a] |
| **Article 26** mirrors it for deployers: retain logs under your control **≥6 months** | [R20-a] |
| For agentic systems, **logging must capture events relevant to risk identification and system monitoring — not only final outputs** | [R20-a] |
| High-risk regime (conformity assessment, risk management, human oversight) deferred by the Digital Omnibus to **2 Dec 2027** (Annex III) and **2 Aug 2028** (Annex I) | [R20-a] |
| **No finalised technical standard for Article 12 logging exists yet.** Two drafts: **prEN 18229-1** (AI logging and human oversight) and **ISO/IEC DIS 24970** (AI system logging) | [R20-a] |
| Agents that score credit, filter resumes, decide benefits, price insurance or triage emergency calls fall under **Annex III = high-risk** | [R20-a] |

**A compaction event is precisely the kind of risk-relevant event nobody currently logs** — the moment an agent's knowledge changed, unrecorded. The obligation is live, the standard is unwritten, and the incumbents are logging *outputs*.

## R21 — Compaction became a first-party API. Threat and gift.

| Finding | Source |
| --- | --- |
| **OpenAI shipped server-side compaction 11 Feb 2026** via the Responses API — `context_management` with `compact_threshold` | [R21-a] |
| **Anthropic's `compact_20260112`** (beta, April 2026) is the most fully specified production compaction interface: configurable thresholds (min 50K, default 150K), **custom summarisation prompts via `instructions`**, streaming compaction blocks, and **`pause_after_compaction`** | [R21-b] |
| `pause_after_compaction: true` — *"the model will pause after generating the compaction summary, allowing you to inspect or process it before continuing… the safest way to build an agent where compaction is a **first-class event rather than a silent background process**"* | [R21-b] |
| Industry shift: from expanding context windows to **smarter context management**; window size is plateauing | [R21-c] |

**Threat:** compaction is becoming standard vendor infrastructure, so "we fix compaction" has a shrinking half-life.

**Gift, and it is larger:** `pause_after_compaction` + custom `instructions` is **an officially supported inspect-and-augment hook at the API layer**. Our Claude-Code-only design (Thread 9) generalises: capture → **pause** → verify → augment the summary or block → continue. That works for anyone building on the Anthropic API, which is where enterprise money is — not just Claude Code users.

## R22 — Distribution and pricing reference points

| Finding | Source |
| --- | --- |
| **Open-core is the proven distribution route here.** Langfuse: open source from the start, "core expanding, periphery shrinking," explicitly credits OSS for integration velocity across LangChain, LiteLLM, OpenTelemetry | [R22-a] |
| **MCP is now vendor-neutral** — Anthropic donated it to the **Agentic AI Foundation** (Linux Foundation directed fund, co-founded with Block and OpenAI) in Dec 2025 | [R22-b] |
| Agentic coding tools already carry **$200–$2,000+/engineer/month** in usage costs; all-in $200–600/dev/month typical | [R22-c] |
| Flat enterprise seats have **stabilised at $30–60/user/month**; pure per-seat fell from 21%→15% of SaaS vendors, most moving to **hybrid (seat + usage overage)** | [R22-c] |
| Seed market: **median ~$9.2M across 22 deals**; VCs now demand production eval scores, defensibility beyond the model, and unit economics after inference cost | [R22-d] |
| Investor framing: *"if your agent succeeds 70% of the time it's a toy; 95% it's a business"* — and the strongest signal is in companies that help enterprises **see, test, constrain or audit agents before they create risk** | [R22-d] |

---

# Round 5 — Integration architecture (framework-neutral)

Round 5 was triggered by a correction: the product is for **agents generally**, not Claude Code. Claude Code is a proving ground; building the architecture around its hooks was an error. This round asks: **how do you intercept and enforce across all agent frameworks?**

## R23 — Framework callbacks cannot enforce. This is decisive.

| Framework | Interception available | Can it block? |
| --- | --- | --- |
| **LangChain `BaseCallbackHandler`** | 20 lifecycle events | **No** — the dispatcher **discards handler return values**, so a callback cannot block or rewrite anything |
| **CrewAI event bus** | **78 typed event kinds** | **No** — all observe-only |
| **LlamaIndex instrumentation** | Telemetry module | **No** — "telemetry by design: no return value, exception, or mutation reaches the underlying action" |
| **OpenAI Agents SDK** | Lifecycle hooks + guardrails | **Partially** — guardrails block, but input guardrails **race the first model call** unless a flag is set |
| **Claude Code hooks** | `PreToolUse` etc. | **Yes** (exit 2) |

Source: [R23-a]

**Consequence: a per-framework SDK integration strategy cannot deliver enforcement.** Most frameworks will let us watch and nothing more. Any plan built on "hook into each framework" delivers a dashboard, not a gate.

## R24 — Microsoft shipped exactly the substrate we need, and left our gap open

**AGENT-HOOKS-0.1** — an open, framework-neutral governance contract [R24-a]:

- **8 interception points:** `agent_startup`, `input`, `pre_model_call`, `post_model_call`, `pre_tool_call`, `post_tool_call`, `output`, `agent_shutdown`
- **Interceptors return a verdict: allow, deny, transform** — explicitly fixing the observe-only gap in R23. ACS extends verdicts to allow/warn/deny/escalate with redaction effects [R24-b]
- **Fail-closed by specification:** "a host that cannot build a valid context, cannot reach an interceptor, times one out, or receives a malformed verdict **must synthesize a deny**"
- **Conformance demonstrated across 8 frameworks:** LangGraph, OpenAI Agents SDK, Microsoft Agent Framework, Semantic Kernel, LlamaIndex, CrewAI, Claude Agent SDK, reference host
- **SDKs in Python, TypeScript, .NET, Rust and Go**; versioned spec, published schemas, public proposals, and a **47-scenario conformance kit** that makes "supported" testable
- **Agent Control Specification (ACS)** — the policy-runtime layer, announced at Build 2026, MIT-licensed at `microsoft/agent-governance-toolkit`, **Public Preview**, Python/TypeScript/.NET first-class with TS at full parity, 7 independently installable packages, covering 10/10 OWASP Agentic Top 10. Microsoft states intent to move it to a foundation. **CrewAI publicly supports it** [R24-c]

**The decisive sentence, from reading the ACS spec:** it **does not address context integrity assurance or memory/compaction event handling** [R24-b].

So the framework-neutral enforcement substrate now exists, is MIT-licensed, can block, fails closed, spans 8 frameworks and 5 languages — **and has no concept of whether the agent still knows what it needed to know.** That is precisely our wedge, and it means we build one interceptor instead of N framework integrations.

**Risk to record:** AGENT-HOOKS is **0.1** and AGT is **Public Preview**. Betting the entire architecture on a three-month-old spec is a real exposure. Mitigation: treat Agent Hooks as the *primary adapter*, not the only one — keep the core adapter-agnostic so direct integrations (Claude Code hooks, proxy, OTel) remain viable if adoption stalls.

## R25 — Attestation and telemetry standards already exist; do not invent formats

| Standard | What it is | Status |
| --- | --- | --- |
| **TRACE** (Trust, Runtime Attestation and Compliance Evidence) | Hardware-backed, cryptographically verifiable record binding runtime environment, software executed, policies applied, data classification and tools invoked — "a tamper-resistant receipt for an agent's activity." Composes **RFC 9711 (EAT)**, **RFC 9334 (RATS)**, **SCITT**, SLSA, SPIFFE, EAR | **Linux Foundation governance**, technical work hosted by **CoSAI**; from OPAQUE with AMD, Intel, Microsoft, TII. **~135K PyPI downloads in 10 weeks** [R25-a] |
| **OTel GenAI `gen_ai.*`** | Span conventions | Development status; Datadog, Langfuse, Arize ingest natively [R5-c] |
| **OpenInference** | Span types LLM/TOOL/AGENT/CHAIN/RETRIEVER; closest alignment to OTel GenAI | Arize-backed [R25-b] |
| **OpenLLMetry** (traceloop) | Widest catalog: **Python 30+ integrations**, TypeScript (incl. Claude Agent SDK, Vercel AI, Mastra), Java | [R25-b] |

**Our P3 attestation log should emit TRACE-shaped evidence**, not a bespoke format — it already composes the IETF standards an auditor will ask for, and it maps onto the EU AI Act Article 12 obligation [R20-a].

## R26 — Gateway implementation-language evidence

| Finding | Source |
| --- | --- |
| **LiteLLM migrated its core to Rust**: throughput **453 → 6,782 rps (~15×)**, memory **359MB → 32MB (~11×)**, per-request overhead **7.5ms → 0.05ms**. Shipped as **Rust core with Python SDK** | [R26-a] |
| Bifrost (Go) reports large gains over Python LiteLLM on the same axis | [R26-b] |
| Rust now owns the JS toolchain (oxlint 50–100× ESLint); **the TypeScript compiler is being ported to Go**, not Rust | [R26-c] |
| TypeScript: ~50M weekly downloads, 75%+ npm adoption, 78% of professional JS devs | [R26-c] |

**Important scope note:** these numbers are for **high-throughput gateways on the hot path**. We are a verification sidecar making one decision per interception point, behind model calls that take 50–1000× longer than any of this [R5-a]. **Gateway throughput benchmarks do not transfer to our workload** and should not drive our language choice.

## R27 — Where the agents actually are

| Finding | Source |
| --- | --- |
| **57% of teams run AI agents in production**; **67%** at organisations with 10,000+ employees | [R27-a] |
| Python still dominates agent development — nearly half of all new AI repos, ~300K-package ML ecosystem, first-class SDK support from every major lab | [R27-a] |
| TypeScript became first-class in 2026: every major framework ships a TS path (LangGraph.js, OpenAI Agents JS, ADK TypeScript, Strands TS); **OpenAI Agents SDK for TypeScript hit ~1.5M downloads in a 30-day window** (March 2026) | [R27-a] |
| The distinction drawn: "TypeScript catches up only at the **application layer** — building products that use AI, not building the AI itself" | [R27-a] |
| OpenLLMetry coverage asymmetry confirms it: **Python 30+ integrations vs TypeScript ~8** | [R25-b] |

## R28 — Prior art much closer to us than anything in Rounds 1–4

| Project | What it does | Source |
| --- | --- | --- |
| **OWASP Agent Memory Guard** | Runtime defence layer validating **memory integrity via cryptographic baselines (SHA-256)**, detecting injection and anomalies, enforcing declarative YAML policies, **drop-in middleware for LangChain, LlamaIndex, CrewAI** | [R28-a] |
| **agent-memory-doctor** (PyPI) | Boot-time integrity check for agent memory and convention files that **"catches silent convention loss"**, injection dilution, broken rollback anchors. Zero deps, stdlib-only | [R28-b] |
| **ElephantAgent** | Detects tool poisoning by binding tool state to a linearizable state history — violation of *Contextual State Continuity* | [R28-c] |
| **VerificAgent** | Treats persistent memory as an explicit alignment surface; curated domain knowledge + trajectory-based memory growth + post-hoc human fact-checking | [R28-d] |
| **Cisco Watchdog** | IDE-integrated scanner preventing context manipulation by tracking sensitive files and notifying on change | [R28-e] |

**Blunt:** "silent convention loss" is nearly a restatement of our D1 constraint-survival detector, and it already ships. The honest remaining distinctions are narrow but real:

1. These are **adversarial/security** framings (poisoning, injection) or **boot-time** checks. Ours is **non-adversarial, mid-session loss caused by the agent's own optimisations** — compaction, eviction, cache hits.
2. None runs a **matched control window**, so none can separate compaction damage from normal agent behaviour.
3. None offers a **statistical guarantee** (conformal bounds).
4. None verifies **net savings** (Gate 2).

**That is the whole moat now. It should be stated in the plan exactly that plainly.**

---

## Sources

**R1 — Agentic cost**
[R1-a] [Spheron — Agentic AI Inference Cost: Why Agents Burn 5-30x Tokens](https://www.spheron.network/blog/agentic-ai-inference-cost-2026/) · [TechAhead — Inference Cost Explosion](https://www.techaheadcorp.com/blog/inference-cost-explosion/) · [Tentoro — AI Agent Token Sprawl](https://tentoro.ai/blog/ai-agent-token-sprawl/)
[R1-b] [arXiv 2605.09104 — Token Economics for LLM Agents](https://arxiv.org/html/2605.09104v1)
[R1-c] [Finout — Agentic AI Cost Governance](https://www.finout.io/blog/agentic-ai-cost-governance-controlling-spend-before-it-controls-you) · [MintMCP — AI Agent Monitoring](https://www.mintmcp.com/blog/ai-agent-monitoring) · [Bigeye — Track AI agent costs and token usage](https://www.bigeye.com/blog/how-to-track-ai-agent-costs-and-token-usage)

**R2 — Quality gate**
[R2-a] [arXiv 2606.19544 — Reliability without Validity: LLM-as-a-Judge across Agreement, Consistency, Bias](https://arxiv.org/pdf/2606.19544) · [arXiv 2512.01232 — LLM-as-a-Judge: Accuracy, Operational Reliability, and Cost](https://arxiv.org/pdf/2512.01232) · [Arize — LLM evaluation costs](https://arize.com/resources/llm-evaluation-costs/) · [DeepEval — LLM-as-a-Judge 2026](https://deepeval.com/blog/llm-as-a-judge)
[R2-b] [DEV — Semantic Caching: The 95% Hit Rate Myth vs Production Data](https://dev.to/gauravdagde/llm-semantic-caching-the-95-hit-rate-myth-and-what-production-data-actually-shows-8ga) · [PyImageSearch — Semantic Caching: TTLs, Confidence, Cache Safety](https://pyimagesearch.com/2026/05/04/semantic-caching-for-llms-ttls-confidence-and-cache-safety/)
[R2-c] [arXiv 2601.23088 — Key Collision Attack on LLM Semantic Caching](https://arxiv.org/html/2601.23088v2)
[R2-d] [arXiv 2606.22528 — Governance Decay: How Context Compaction Silently Erases Safety Constraints](https://arxiv.org/pdf/2606.22528)

**R3 — Competitive**
[R3-a] [Deepak Gupta — Top 5 AI Gateways 2026](https://guptadeepak.com/tools/top-5-ai-gateways-2026/) · [Flotorch — LLM Gateway Comparison 2026](https://www.flotorch.ai/blogs/llm-gateway-comparison-2026) · [Klymentiev — LLM Gateway 2026](https://klymentiev.com/blog/llm-gateway-guide)
[R3-b] [OrcaRouter — Not Diamond vs Martian](https://www.orcarouter.ai/blog/not-diamond-vs-martian) · [arXiv 2501.01818 — Rerouting LLM Routers](https://arxiv.org/pdf/2501.01818)
[R3-c] [RouterArena (ICLR 2026)](https://proceedings.iclr.cc/paper_files/paper/2026/file/4987bb24bc53c198785922d1bd9e18cf-Paper-Conference.pdf) · [arXiv 2510.00202](https://arxiv.org/abs/2510.00202) · [GitHub — RouteWorks/RouterArena](https://github.com/RouteWorks/RouterArena)
[R3-d] [MarkTechPost — Top LLM Observability and Evaluation Platforms 2026](https://www.marktechpost.com/2026/08/09/top-llm-observability-and-evaluation-platforms-in-2026-langfuse-langsmith-braintrust-arize-and-more-compared/) · [BirJob — AI Observability Stack 2026](https://www.birjob.com/blog/ai-observability-stack-2026) · [Grepture — LLM Observability Tools Compared](https://grepture.com/blog/llm-observability-tools-comparison)

**R4 — Optimization levers**
[R4-a] [DEV — OpenAI prompt caching explained: automatic, 90% off](https://dev.to/rikuq/openai-prompt-caching-explained-automatic-free-to-enable-90-off-cached-input-tokens-7bn) · [AgentMarketCap — Prompt Caching Economics 2026](https://agentmarketcap.ai/blog/2026/04/06/prompt-caching-economics-2026-anthropic-google-agent-cost)
[R4-b] [DigitalApplied — Prompt Caching in 2026](https://www.digitalapplied.com/blog/prompt-caching-2026-cut-llm-costs-engineering-guide) · [ofox — Anthropic vs OpenAI Prompt Caching 2026](https://ofox.ai/blog/prompt-caching-cost-math-anthropic-vs-openai-2026/)
[R4-c] [DEV — Context compaction in agent frameworks](https://dev.to/crabtalk/context-compaction-in-agent-frameworks-4ckk) · [arXiv 2604.03515 — Inside the Scaffold: Source-Code Taxonomy of Coding Agent Architectures](https://arxiv.org/pdf/2604.03515) · [Microsoft Learn — Compaction](https://learn.microsoft.com/en-us/agent-framework/concepts/agents/conversations/compaction)
[R4-d] [LangChain — Context Management for Deep Agents](https://www.langchain.com/blog/context-management-for-deepagents) · [arXiv 2606.17016 — TokenPilot: Cache-Efficient Context Management for LLM Agents](https://arxiv.org/pdf/2606.17016)
[R4-e] [microsoft/LLMLingua](https://github.com/microsoft/LLMLingua) · [arXiv 2403.12968 — LLMLingua-2](https://arxiv.org/pdf/2403.12968) · [arXiv 2310.06839 — LongLLMLingua](https://arxiv.org/pdf/2310.06839)
[R4-f] [LMSYS — RouteLLM](https://www.lmsys.org/blog/2024-07-01-routellm/) · [arXiv 2406.18665 — RouteLLM: Learning to Route LLMs with Preference Data](https://arxiv.org/pdf/2406.18665) · [GitHub — lm-sys/RouteLLM](https://github.com/lm-sys/routellm)

**R5 — Integration & latency**
[R5-a] [LiteLLM Benchmarks](https://docs.litellm.ai/docs/benchmarks) · [DeepInspect — AI Gateway Sub-50ms Latency](https://www.deepinspect.ai/blog/ai-gateway-sub-50ms-latency)
[R5-b] [DeepInspect — AI Gateway Latency Benchmarks: Reading the 2026 Numbers](https://www.deepinspect.ai/blog/ai-gateway-latency-benchmarks)
[R5-c] [OpenTelemetry — Inside the LLM Call: GenAI Observability](https://opentelemetry.io/blog/2026/genai-observability/) · [Greptime — OTel GenAI Semantic Conventions](https://greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions) · [open-telemetry/semantic-conventions-genai #35](https://github.com/open-telemetry/semantic-conventions-genai/issues/35)

**R6 — Pricing**
[R6-a] [ProsperOps — Price vs. Value: Selecting the Best AWS Cost Optimization Tool](https://www.prosperops.com/blog/price-vs-value-selecting-the-best-aws-cost-optimization-tool/) · [CloudKeeper — Choosing the Right Cloud Pricing Model](https://www.cloudkeeper.com/insights/blog/guide-choosing-right-cloud-pricing-model)

**R7 — Buyer**
[R7-a] [Maxim — Top 5 LLM Gateway Governance Platforms for Regulated Teams](https://www.getmaxim.ai/articles/top-5-llm-gateway-governance-platforms-for-regulated-teams/) · [Maxim — AI Governance for Enterprise LLM Deployments](https://www.getmaxim.ai/articles/ai-governance-for-enterprise-llm-deployments-a-complete-guide/)

**R8 — Cache vs. optimization conflict**
[R8-a] [Mastra — Prompt caching: how it works and how to cut LLM token costs](https://mastra.ai/articles/prompt-caching) · [Karan Bansal — Prompt Caching Doesn't Cache Prompts](https://karanbansal.in/blog/prompt-caching/) · [Claude Platform Docs — Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
[R8-b] [arXiv 2601.06007 — Don't Break the Cache: An Evaluation of Prompt Caching for Long-Horizon Agentic Tasks](https://arxiv.org/abs/2601.06007)
[R8-c] [hermes-agent #13631 — auto-injected context rebuilds cached system prompt, invalidating KV cache](https://github.com/NousResearch/hermes-agent/issues/13631) · [#8687 — system prompt timestamp changes after compression](https://github.com/NousResearch/hermes-agent/issues/8687)
[R8-d] [LangChain — Prompt Caching with Deep Agents](https://www.langchain.com/blog/deep-agents-prompt-caching)
[R8-e] [Derive AI — How prompt caching cut our production AI agent input costs by 77%](https://derivai.substack.com/p/prompt-caching-production-ai-agent-costs) · [ProjectDiscovery — How We Cut LLM Costs by 59% With Prompt Caching](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching) · [arXiv 2603.15183 — Token Coherence: MESI Cache Protocols for Multi-Agent LLM Systems](https://arxiv.org/pdf/2603.15183)

**R9 — Prior art on the optimization engine**
[R9-a] [arXiv 2606.17016 — TokenPilot: Cache-Efficient Context Management for LLM Agents](https://arxiv.org/abs/2606.17016) · [code: github.com/zjunlp/RSI](https://github.com/zjunlp/RSI)

**R10 — Deterministic gate design**
[R10-a] [arXiv 2609.02246 — LLM-as-a-Judge Is Not an Oracle: Why Self-Improving Agents Need Deterministic Guardrails](https://arxiv.org/abs/2609.02246)
[R10-b] [arXiv 2604.22891 — Quantifying and Mitigating Self-Preference Bias of LLM Judges](https://arxiv.org/html/2604.22891v4) · [arXiv 2608.18091 — Self- and Other-Labels Induce Bidirectional Bias in LLM Judges](https://arxiv.org/html/2608.18091) · [MATS — LLM Evaluators Recognize and Favor Their Own Generations](https://www.matsprogram.org/research/llm-evaluators-recognize-and-favor-their-own-generations)
[R10-c] [Kalvium Labs — LLM Guardrails in Production](https://www.kalviumlabs.ai/blog/guardrails-for-llm-applications/)
[R10-d] [arXiv 2604.23577 — RouteNLP: Closed-Loop LLM Routing with Conformal Cascading and Distillation Co-Optimization](https://arxiv.org/pdf/2604.23577)
[R10-e] [arXiv 2606.22737 — GroundEval: A Deterministic Replacement for LLM-as-Judge in Stateful Agent Evaluation](https://arxiv.org/pdf/2606.22737)

**R11 — Statistical guarantees**
[R11-a] [arXiv 2606.29054 — When Can Conformal Risk Control Certify LLM Outputs?](https://arxiv.org/html/2606.29054v1) · [ACL 2026 — Conformal LLM Routing with Distribution-Free Safety](https://aclanthology.org/2026.acl-srw.70.pdf) · [arXiv 2602.13110 — SCOPE: Selective Conformal Optimized Pairwise LLM Judging](https://arxiv.org/html/2602.13110v2) · [arXiv 2506.00911 — Conformal Arbitrage](https://arxiv.org/pdf/2506.00911)
[R11-b] [arXiv 2601.20251 — Efficient Evaluation of LLM Performance with Statistical Guarantees (Wu, Nair, Candès)](https://arxiv.org/abs/2601.20251)
[R11-c] [Arize — LLM evaluation costs](https://arize.com/resources/llm-evaluation-costs/)
[R11-d] [BuildMVPFast — AI Agent SLAs: Uptime, Accuracy, and Response Time Guarantees](https://www.buildmvpfast.com/blog/ai-agent-sla-uptime-accuracy-response-time-guarantee-2026) · [Vertice — AI Cost Optimization](https://www.vertice.one/platform/ai-cost-optimization)

**R13 — Compaction pain in the wild**
[R13-a] [anthropics/claude-code #10948 — Auto-compact triggers mid-task causing context loss and hallucinations](https://github.com/anthropics/claude-code/issues/10948) · [#13112 — Auto-Compact causes context loss and degraded performance](https://github.com/anthropics/claude-code/issues/13112)
[R13-b] [ByteBell — Claude Code Keeps Compacting and Losing My Work](https://bytebell.ai/blog/claude-code-compacting-losing-work/) · [DEV — Why Claude Code Forgets Everything (And How to Fix It)](https://dev.to/scottcrawford/why-claude-code-forgets-everything-and-how-to-fix-it-5d58) · [DEV — Taming Context Windows: Disable Auto-Compact](https://dev.to/agentic-engineer/taming-context-windows-disable-auto-compact-for-better-ai-4gbm) · [Golev — Claude Saves Tokens, Forgets Everything](https://golev.com/post/claude-saves-tokens-forgets-everything/)
[R13-c] [Braintrust — Best AI agent memory tools 2026](https://www.braintrust.dev/articles/best-ai-agent-memory-tools-2026) · [DEV — Multi-Agent Memory in 2026: One Pattern, One Spec](https://dev.to/whoffagents/multi-agent-memory-in-2026-5-recent-posts-one-pattern-one-spec-4046)
[R13-d] [Hyperdev — How Claude Code Got Better by Protecting More Context](https://hyperdev.matsuoka.com/p/how-claude-code-got-better-by-protecting)

**R14 — Measured compaction damage**
[R14-a] [arXiv 2608.06503 — Toward Reliable Context Compression for Long-Horizon Agents: An Empirical Study of Execution Instability](https://arxiv.org/html/2608.06503v1)
[R14-b] [arXiv 2606.22528v2 — Governance Decay](https://arxiv.org/html/2606.22528v2)
[R14-c] [arXiv 2603.24755 — SlopCodeBench: Benchmarking How Coding Agents Degrade Over Long-Horizon Iterative Tasks](https://arxiv.org/abs/2603.24755)
[R14-d] [arXiv 2607.05378 — CompactionRL](https://arxiv.org/pdf/2607.05378) · [arXiv 2606.11213 — Beyond Compaction: Structured Context Eviction](https://arxiv.org/pdf/2606.11213) · [arXiv 2605.23296 — Parallel Context Compaction](https://arxiv.org/html/2605.23296v1)

**R15 — Deterministic oracles for code**
[R15-a] [arXiv 2605.26457 — Verus-SpecGym](https://arxiv.org/html/2605.26457v1) · [arXiv 2609.02246 — LLM-as-a-Judge Is Not an Oracle](https://arxiv.org/abs/2609.02246)
[R15-b] [ZenML LLMOps Database — Checkout: Deterministic Verification Layer for AI Coding Agents](https://www.zenml.io/llmops-database/deterministic-verification-layer-for-ai-coding-agents)
[R15-c] [arXiv 2606.24453 — Bayesian control for coding agents](https://arxiv.org/pdf/2606.24453)

**R17 — Price collapse**
[R17-a] [a16z — LLMflation](https://a16z.com/llmflation-llm-inference-cost/) · [Wavect — LLM API Costs Dropped 80% in 2026](https://wavect.io/blog/llm-api-costs-2026-architecture-shift/) · [AI Magicx — The LLM Pricing Collapse of 2026](https://www.aimagicx.com/blog/llm-pricing-collapse-developer-guide-building-cheap-ai-2026)
[R17-b] [BenchLM — LLM API Pricing Trends (September 2026)](https://benchlm.ai/llm-pricing-trends) · [Silicon Data — LLM Cost Per Token 2026](https://www.silicondata.com/blog/llm-cost-per-token)

**R18 — The correctness problem**
[R18-a] [Deloitte/McKinsey/Gartner roundup — 89% of AI Agent Pilots Never Reach Production](https://www.luizneto.ai/ai-agent-production-refresh-2026/) · [AgentMarketCap — Enterprise Agent Deployment Maturity Model 2026](https://agentmarketcap.ai/blog/2026/04/11/enterprise-agent-deployment-maturity-model-2026) · [Inovabeing — Why AI Agents Fail in Production](https://www.inovabeing.com/blog/ai-agent-reliability-production-failure-2026)
[R18-b] [FutureAGI — Why do multi-agent LLM systems fail (MAST)](https://futureagi.substack.com/p/why-do-multi-agent-llm-systems-fail) · [arXiv 2606.20695 — Paired Noise-Floor Protocol for Multi-Agent Benchmarks](https://arxiv.org/pdf/2606.20695)
[R18-c] [Kiteworks — AI Agent Security Incidents Hit 65% of Firms in 2026](https://www.kiteworks.com/cybersecurity-risk-management/ai-agent-security-incidents-2026/) · [Cyera — Agent-Inflicted Damage](https://www.cyera.com/research/agent-inflicted-damage-inside-the-real-world-failures-of-enterprise-ai-systems) · [ContextQA — The Cost of AI Agent Failures](https://contextqa.com/blog/cost-of-ai-agent-failures/)
[R18-d] [Atlassian — MCP Compression: Preventing tool bloat](https://www.atlassian.com/blog/development/mcp-compression-preventing-tool-bloat-in-ai-agents) · [DEV — MCP Server Token Bloat: 55,000 Tokens Wasted](https://dev.to/pickuma/mcp-server-token-bloat-55000-tokens-wasted-before-your-agent-runs-13j5) · [MCP.Directory — MCP Context Bloat Fix 2026](https://mcp.directory/blog/mcp-context-bloat-fix-2026-tool-search-code-mode-progressive-disclosure) · [Apideck — Your MCP Server Is Eating Your Context Window](https://www.apideck.com/blog/mcp-server-eating-context-window-cli-alternative)
[R18-e] [OpenBox/Gartner — 40% will scale back autonomous agents by 2027](https://www.prnewswire.com/news-releases/openbox-ai-partners-with-copilotkit-to-bring-enterprise-grade-trust-to-agentic-ai-302811355.html)
[R18-f] [Redis — Context rot explained](https://redis.io/blog/context-rot/) · [Morph — Context Rot: Why LLMs Degrade as Context Grows](https://www.morphllm.com/context-rot) · [arXiv 2605.12922 — When Attention Closes](https://arxiv.org/pdf/2605.12922) · [arXiv 2601.15300 — Intelligence Degradation in Long-Context LLMs](https://arxiv.org/pdf/2601.15300)
[R18-g] [Galileo — 8 Best AI Agent Guardrails Solutions in 2026](https://galileo.ai/blog/best-ai-agent-guardrails-solutions) · [Harvey — Guardrails AI Joins Harvey](https://www.harvey.ai/blog/guardrails-ai-joins-harvey)

**R19 — The runtime-governance lane**
[R19-a] [OpenBox AI Raises $5 Million to Build Agent Governance Infrastructure](https://www.tokenpost.com/news/technology/19480) · [OpenBox AI × CopilotKit](https://www.prnewswire.com/news-releases/openbox-ai-partners-with-copilotkit-to-bring-enterprise-grade-trust-to-agentic-ai-302811355.html) · [OpenBox AI × Temporal — runtime governance for long-running agents](https://www.prnewswire.com/news-releases/as-enterprises-move-ai-agents-into-production-openbox-ai-and-temporal-introduce-runtime-governance-for-long-running-agents-302820622.html)
[R19-b] [PredictionGuard — Runtime AI policy enforcement: the control plane for agent governance](https://predictionguard.com/blog/runtime-ai-policy-enforcement) · [arXiv 2603.16586 — Runtime Governance for AI Agents: Policies on Paths](https://arxiv.org/html/2603.16586v1) · [arXiv 2606.19464 — Deontic Policies for Runtime Governance of Agentic AI](https://arxiv.org/pdf/2606.19464) · [Sweet Security — AI Agent Policy Enforcement 2026](https://www.sweet.security/agent-security/ai-agent-policy-enforcement)

**R20 — Regulation**
[R20-a] [Help Net Security — What the EU AI Act requires for AI agent logging](https://www.helpnetsecurity.com/2026/04/16/eu-ai-act-logging-requirements/) · [Legiscope — EU AI Act Deadlines 2026-2027](https://www.legiscope.com/blog/eu-ai-act-timeline-deadlines.html) · [Truescreen — Article 12 Record-Keeping Requirements](https://truescreen.io/insights/ai-act-record-keeping-requirements/) · [A4BEE — What Changes on 2 August 2026 for High-Risk Agents](https://a4bee.com/article/ai-agents-eu-ai-act-ready/)

**R21 — First-party compaction APIs**
[R21-a] [vercel/ai #12486 — OpenAI server-side compaction (context_management)](https://github.com/vercel/ai/issues/12486)
[R21-b] [Claude Platform Docs — Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) · [Claude Lab — Context Compaction API Complete Guide](https://claudelab.net/en/articles/api-sdk/compaction-api-context-management) · [AI SDK — Anthropic provider](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic)
[R21-c] [Implicator — AI Agents Need Context Compaction Before 100 Percent](https://www.implicator.ai/anthropic-openai-google-tell-developers-to-budget-ai-context-windows/) · [Justin3go — Context Compaction in Codex, Claude Code, and OpenCode](https://justin3go.com/en/posts/2026/04/09-context-compaction-in-codex-claude-code-and-opencode)

**R22 — Distribution, pricing, capital**
[R22-a] [Langfuse — Why is Langfuse Open Source?](https://langfuse.com/handbook/chapters/open-source) · [Langfuse — Doubling Down on Open Source](https://langfuse.com/blog/2025-06-04-open-sourcing-langfuse-product)
[R22-b] [Sourcegraph — Context Engineering: A Practical Guide](https://sourcegraph.com/blog/context-engineering) · [Redis — The state of context engineering 2026](https://redis.io/resources/state-of-context-engineering-2026/)
[R22-c] [DX — AI coding assistant pricing and ROI guide 2026](https://getdx.com/blog/ai-coding-assistant-pricing/) · [vexp — AI Coding Cost Per Engineer Per Month](https://vexp.dev/blog/ai-coding-cost-per-engineer-per-month-2026-benchmarks) · [Korix — The 6 AI Pricing Models Ranked](https://korixinc.com/learning-center/ai-pricing-models-2026)
[R22-d] [Causo — Raising a seed round for an AI agent startup in 2026](https://hub.causo.ai/guides/raising-seed-for-ai-agent-startup-2026) · [New Market Pitch — AI Safety Market Funding News (June 2026)](https://newmarketpitch.com/blogs/news/ai-safety-funding-news) · [AI Funding — 78 Agentic AI Startups, Rounds & Valuations](https://aifunding.me/ai-agent-funding)

**R23 — Framework interception limits**
[R23-a] [Morph — AI Agent Frameworks 2026: 8 SDKs Compared](https://www.morphllm.com/ai-agent-framework) · [Microsoft Command Line — Agent Hooks](https://commandline.microsoft.com/agent-hooks-framework-neutral-ai-governance-contract/)

**R24 — Agent Hooks / ACS**
[R24-a] [Agent Hooks: An open, framework-neutral AI governance contract (AGENT-HOOKS-0.1)](https://commandline.microsoft.com/agent-hooks-framework-neutral-ai-governance-contract/) · [github.com/responsibleai/agent-hooks](https://github.com/responsibleai/agent-hooks)
[R24-b] [Agent Control Specification: Portable runtime governance for AI Agents](https://commandline.microsoft.com/agent-control-specification-runtime-governance/) · [AgentLux — ACS explainer](https://agentlux.ai/blog/agent-control-specification-acs-the-open-standard-for-ai-agent-governance)
[R24-c] [microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit) · [Microsoft Open Source Blog — Introducing the Agent Governance Toolkit](https://opensource.microsoft.com/blog/2026/04/02/introducing-the-agent-governance-toolkit-open-source-runtime-security-for-ai-agents/) · [Microsoft Foundry — Build 2026 open trust stack](https://devblogs.microsoft.com/foundry/build-2026-open-trust-stack-ai-agents/)

**R25 — Attestation & telemetry standards**
[R25-a] [Linux Foundation — Welcomes TRACE](https://www.linuxfoundation.org/press/linux-foundation-welcomes-trace-to-advance-verifiable-runtime-evidence-for-ai-workloads) · [Help Net Security — TRACE, hardware-backed runtime evidence](https://www.helpnetsecurity.com/2026/08/26/the-linux-foundation-trace-ai-agent-security/) · [SecurityWeek — Linux Foundation to Govern TRACE](https://www.securityweek.com/linux-foundation-to-govern-trace-an-open-standard-for-ai-runtime-attestation/amp/)
[R25-b] [FutureAGI — OpenInference vs OpenLLMetry vs OpenLIT 2026](https://futureagi.com/blog/openinference-vs-openllmetry-vs-openlit-2026/) · [Arize — OpenInference vs OTel GenAI for Agent Tracing](https://www.arthur.ai/column/openinference-vs-opentelemetry-genai-conventions-agent-tracing) · [openinference docs](https://arize-ai.github.io/openinference/)

**R26 — Gateway language benchmarks**
[R26-a] [LiteLLM — Migrating LiteLLM to Rust](https://docs.litellm.ai/blog/litellm-rust-launch) · [BerriAI/litellm](https://github.com/BerriAI/litellm)
[R26-b] [DEV — How a Go-Based LLM Gateway Achieves Extreme Performance Gains (Bifrost vs LiteLLM)](https://dev.to/crosspostr/how-a-go-based-llm-gateway-achieves-extreme-performance-gains-bifrost-vs-litellm-1l3o)
[R26-c] [DEV — Rust Owns the JavaScript Toolchain in 2026](https://dev.to/agnelnieves/rust-owns-the-javascript-toolchain-in-2026-l9b) · [PkgPulse — The State of TypeScript Tooling in 2026](https://www.pkgpulse.com/guides/state-of-typescript-tooling-2026)

**R27 — Ecosystem language distribution**
[R27-a] [DevToolLab — Best AI Agent Frameworks 2026: Python & TypeScript Compared](https://devtoollab.com/blog/best-ai-agent-frameworks) · [Kunal Ganglani — Python vs TypeScript for AI in 2026](https://www.kunalganglani.com/blog/python-vs-typescript-for-ai) · [LangChain — The best AI agent frameworks in 2026](https://www.langchain.com/resources/ai-agent-frameworks)

**R28 — Closest prior art**
[R28-a] [OWASP Agent Memory Guard](https://owasp.org/www-project-agent-memory-guard/)
[R28-b] [agent-memory-doctor (PyPI)](https://pypi.org/project/agent-memory-doctor/)
[R28-c] [arXiv 2607.01919 — ElephantAgent: Contextual State Continuity in Agentic Systems](https://arxiv.org/pdf/2607.01919)
[R28-d] [arXiv 2506.02539 — VerificAgent: Domain-Specific Memory Verification](https://arxiv.org/html/2506.02539v3)
[R28-e] [Cisco — AI Agent Security Scanner for IDEs](https://blogs.cisco.com/ai/introducing-the-ai-agent-security-scanner-for-ides-verify-your-agents)
