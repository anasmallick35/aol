# AOL — Decision Debate Log

**Purpose:** the *reasoning trail*. [02-fundamentals-decision-log.md](02-fundamentals-decision-log.md) records what we decided; this records **how we got there** — what was proposed, what was pushed back on, what evidence moved us, and what we rejected and why. Read this when a decision later looks arbitrary, or when someone new asks "why didn't you just…".

**Format:** newest thread at the bottom. Each thread: the position, the counter-position, the evidence, where it landed. Threads stay open until the corresponding D-number closes.

---

## Thread 1 — "Ten engines" → one wedge
**Date:** pre-2026-09-13 (planning discussion, recorded retroactively)

**Position:** the v1.0 vision doc describes ten engines and a five-phase roadmap ending in a platform/marketplace.

**Counter:** that is ten products, not one. Building all ten before shipping anything is precisely why "what is our main model" felt undefined.

**Landed:** v1 needs a single wedge; the other nine become an explicit, deferred roadmap. Recorded in brief §1. **Standing constraint for every thread below** — any proposal that re-expands scope has to answer to this.

---

## Thread 2 — Is the wedge "cost reduction" or "verification"?
**Date:** 2026-09-13 · **Decides:** D1

**Position (brief):** agentic workload cost governance with a hard quality-preservation gate. We reduce agent cost; the gate makes it safe.

**Counter (from Round 1 research):** the cost levers are being absorbed by the stack, so "we cut your agent bill" competes with free.
- Provider prompt caching is automatic, 90% off cached input, **30–50% off agent-loop cost, zero quality change, no vendor needed** [R4-a][R4-b]
- Context compaction is built into LangGraph, Deep Agents SDK, Microsoft Agent Framework, OpenAI Agents SDK, Claude Code, CrewAI, AutoGen, Cursor, Aider [R4-c][R4-d]

**But the same research found an unowned problem:** every layer is silently mutating agent context to save money, and nobody proves the result is still correct. Compaction silently erases safety constraints [R2-d]; semantic cache has a ~15% false-positive rate with a bi-encoder and a documented cross-tenant leak [R2-b]; only AutoGen coordinates compaction at all [R4-c]; no stable standard exists to hang agent quality off [R5-c].

**Proposed reframe:** sell verification, not savings.

**Rejected — and the objection was right.** A verification-only layer is **an auditor without authority**: it can report that something broke but cannot fix it, cannot guarantee anything it does not control, must *infer* the cost baseline rather than know it, and sells avoided incidents — which is famously hard to price. **A gate needs something to gate.**

**Counter-proposal (accepted in principle):** own the optimization *and* the gate, end to end. Optimization gives the gate authority (it can block and roll back its own actions), gives us the exact counterfactual for free (we made the change, so we know what the unoptimized request was), and gives us something to charge for. Supported by evidence: closed-loop optimization with guardrails is proven — RouteNLP reports **69–89% savings while maintaining quality**, and automatic rerouting through a 45-minute outage cost only **2.1% quality degradation** [R10-d].

**Landed:** closed loop — **optimize → verify → enforce** — not verification alone, and not optimization alone. The open question moves from *"which one"* to *"which is the product and which is the feature"* — see Thread 5. **D1 still blocked on D0.**

---

## Thread 3 — "We'll build our own cost reduction on our principles"
**Date:** 2026-09-13 · **Decides:** D6, feeds D1

**Position:** we build the cost-reduction engine ourselves, to our own principles, rather than depending on what already exists.

**Blunt counter:** the principle is not the differentiator, the mechanism is — and the best-known mechanism was published and open-sourced three months ago.

**TokenPilot** (EMNLP 2026 Findings, submitted 15 June 2026, Zhejiang University et al., open source at `github.com/zjunlp/RSI`) is *exactly* this design: *Ingestion-Aware Compaction* stabilizes prompt prefixes so compaction doesn't break the cache, *Lifecycle-Aware Eviction* drops segments once task relevance expires. **61%/56% cost reduction isolated, 61%/87% continuous, competitive performance retained.** [R9-a]

**Landed:** we will not out-invent a published, benchmarked, free method with two people. **Integrate TokenPilot-class methods; do not reinvent them.** Our engineering novelty must sit where `pip install` cannot reach it. Writing this down explicitly so we don't spend five months rebuilding it and calling the result proprietary.

**Not rejected:** owning the *orchestration* of optimization (which lever, when, with what gate) is still ours. The distinction is: we own the **policy**, we borrow the **mechanism**.

---

## Thread 4 — The conflict nobody in the plan had accounted for
**Date:** 2026-09-13 · **Decides:** D1 scope, D4

**Finding:** **optimization and caching are enemies.** Prompt caching requires an exact prefix match; a single changed character invalidates everything after it. Compressing or compacting a prompt therefore **destroys the 90% cached-input discount on everything downstream** [R8-a]. There is a paper on precisely this: *Don't Break the Cache* [R8-b]. Rule of thumb from the literature: under ~20 turns, caching wins and you should not compress; beyond that, compression may be worth the cache loss.

**Why it matters:** a naive optimizer can cut token count 40% and **raise the bill**, because it traded a 90% discount for a 5x compression. The dashboard reports a win. The invoice disagrees.

**Landed — this reframes the product.** Verification is not one gate but **two**:
1. **Did quality hold?** (the original claim)
2. **Did the saving actually happen, net of cache effects?** (unowned, and denominated in dollars)

Gate 2 is the more defensible of the two: it is measurable, falsifiable, and no competitor claims it. It also converts our weakest pricing position (Thread 6) into our strongest, because we can state savings we can prove rather than savings we assert.

---

## Thread 5 — "We grade our own homework"
**Date:** 2026-09-13 · **Decides:** D4

**Objection to Thread 2's landing:** if we both optimize and judge the optimization, we have a conflict of interest — and principle #4 is *trust over savings*. An LLM judge scoring our own output is exactly the failure the literature warns about.

**Evidence the objection is serious:**
- Self-preference bias is real and **bidirectional** — authorship labels alone shift scores **even when the evaluated output is identical**; the mechanism traces to perplexity and self-recognition [R10-b]
- *LLM-as-a-Judge Is Not an Oracle* catalogs **11 distinct failures of the evaluation signal** across contract analysis, compliance review and code quality — judge bias, harness/metric failures, ground-truth errors, reward hacking. Worst case: agents scored a **100% pass rate by reading cached answer keys**, concealing **68% true capability** [R10-a]

**Resolution, taken from the same paper:** **demote the judge from oracle to advisor, and gate every change with a deterministic verification layer the judge cannot override** (PROCTOR: hermetic sandboxes, stateless subagents, mechanical pre-apply checks that override the LLM teacher, frozen holdouts, canary cases) [R10-a]. A deterministic alternative for stateful agents already exists [R10-e].

**Landed:** the gate is **deterministic-first, judge-advisory**. This resolves the conflict of interest structurally rather than by promise — a deterministic gate is auditable and reproducible by the customer; an LLM judge is neither. **This is now a hard architectural constraint, not a preference.**

---

## Thread 6 — What are we actually selling?
**Date:** 2026-09-13 · **Decides:** D1, D5 · **OPEN**

**The proposal on the table:** save money via our own optimization, spend part of the saving on judging, deliver a better-quality-and-cheaper response end to end.

**The arithmetic has to work, and it can:**
- Full shadow evaluation **roughly doubles** model spend; a **10% shadow rate** gives a continuous evaluation stream at one-tenth the overhead; routine production sampling runs **5–20%** [R11-c]
- A small judge costs **~$1.01/1K evaluations at 96.6% reliability, 78x cheaper than a frontier judge at better accuracy** [R2-a]
- **Factorized Active Querying** (Stanford — Wu, Nair, Candès) delivers **up to 5× effective sample size gains**: same confidence-interval width at up to 5× fewer queries [R11-b]

**The thing that turns this from a feature into a moat:** **conformal risk control** gives distribution-free, finite-sample guarantees — error rate on the accepted set below a user-specified level with high probability, with thresholds that transfer to deployment [R11-a]. Applied variants already exist for factuality, abstention, routing and pairwise judging. Known limits are also published, so the guarantee has boundaries we must not oversell.

**So the claim becomes contractual rather than rhetorical:** not "we have a quality gate" — anyone can say that — but **"your quality degradation is bounded at ≤ε with probability ≥1−δ, your savings are verified net of cache effects, and here is the evidence trail."** No competitor in the Round 1 set makes a statistical guarantee. Market signal supports it: buyers complain about "SLAs that avoid real operational guarantees," and AI agent SLAs are expected to cover accuracy, fallback, escalation and audit — not just uptime [R11-d].

**Still open — the positioning question this raises:** if the guarantee is the moat and the optimization is table stakes [R9-a], then **the optimization may be the feature and the guarantee the product** — we optimize primarily because it gives the gate authority and hands us the exact counterfactual, but we *sell* the bounded guarantee. That is a different company from "a cheaper way to run agents," and it changes D5: a guarantee is priced flat or on spend, never as a share of savings.

**Blocked on D0.** Question 2 of the gate — *would anyone pay for verification alone?* — is now the load-bearing question for this thread.

---

## Thread 7 — Scope discipline check
**Date:** 2026-09-13 · **Decides:** D1 scope · **OPEN**

**Flagged:** "not only the quality gate — the gate and the correctness also, end to end" re-expands scope to an optimization engine **plus** a quality gate **plus** correctness verification. That is three of the original ten engines, for two people, in 4–5 months. **This is the exact failure mode Thread 1 exists to prevent.**

**Also unresolved:** *correctness of what?* Two very different products hide under that word —
- **(a) correctness of the optimization** — did compression/compaction preserve meaning? Bounded, mechanical, ours.
- **(b) correctness of the agent's task outcome** — did the agent do the right thing? Unbounded, and squarely Braintrust/Arize/LangSmith territory, against $800M-funded incumbents [R3-d].

**Proposed v1 boundary (to confirm when D1 closes):** **one workload shape, one optimization, one gate.** Cache-aware context compaction for agent loops, gated deterministically with conformal bounds, verifying both quality and net savings. Explicitly **not** in v1: model routing, semantic cache, prompt rewriting, task-outcome correctness.

**Semantic cache specifically should be last, not first** — highest quality risk of any lever (~15% false-positive rate, documented cross-tenant leak [R2-b]). Shipping it early would make us the thing we are selling protection against.

**Status: OPEN** — needs an explicit decision, not a drift.

---

## Thread 8 — The founder answered the D0 questions
**Date:** 2026-09-13 · **Decides:** D0, D1, D2 · **PARTLY CLOSED**

**Answers given** (one of us, as a daily Claude Code user): compaction is on and automatic · prompt-caching status unknown · *"when the compaction happens I see that my agent is lagging or forgetting many checks which I asked earlier to do"* · workaround is manually requesting a handoff file **before** compaction fires, then starting a fresh session · savings never measured · would not deploy an unproven optimization · **would pay for proof**.

**First response: this is the single most biased data point obtainable** — the founder answering their own survey about their own idea. "Would you pay?" from inside the company is worth approximately zero.

**But Round 3 checked it against the public record, and the anecdote is representative, not idiosyncratic:**
- Claude Code auto-compact has **dozens of public bug reports** — #10948 "context loss and hallucinations", #13112 "context loss and degraded performance" [R13-a]
- Mechanism confirmed: **lossy, one-way** compression at **~83% context (~167K tokens)**; after **3–4 compression cycles, critical information is permanently gone** [R13-b]
- The community independently reinvented **the same handoff workaround** [R13-b]
- Academia measures it: compression **converts reliably-solved tasks into intermittently-solved ones** under identical conditions [R14-a]; governance decay reproduces across **7 model families and 4 compaction strategies** [R14-b]; coding agents erode in **80% of trajectories** [R14-c]

**Landed — D0 question 1 is closed: teams do notice.** Evidence is public and reproducible, not our word. A spontaneously-reinvented workaround is the strongest cheap signal of genuine pain.
**D0 question 2 remains completely open:** will anyone *pay*. Nothing in Round 3 touches it.

### The uncomfortable part

**The founder's own pain was never about cost.** Every symptom reported was correctness — forgetting, lagging, dropped checks. Cost was never mentioned; savings were never measured. Our own best first-hand evidence describes **a correctness product, not a cost product.**

That is a direct challenge to Thread 2's landing. Options:
- **(i)** the cost framing is wrong and the wedge is compaction safety outright; or
- **(ii)** the founder is a *user* of a coding agent, not a *buyer* of AI infrastructure — and the enterprise burning $400K/year [R1-a] has a different pain and a different budget line.

**Both may be true, and they imply different companies.** Unresolved — this is now the central question for D1/D2.

### The ICP insight, and its risk

Coding agents are **the one workload where the deterministic gate is nearly free**: the oracle already exists (tests, compiler, type checker, linter). Deterministic checks cost near zero and **catch 26% of failures LLM-judge baselines miss** [R15-a]. That collapses D4's hardest open problem — but only for this ICP.

**Against it, three things:**
1. **Platform risk.** Anthropic owns Claude Code *and* its compaction, and is actively improving it [R13-d]. A product built on a first-party defect can be deleted by a release.
2. **Competition already exists in this exact shape** — "Checkout: Deterministic Verification Layer for AI Coding Agents" [R15-b]. "Nobody is doing this" is no longer true for the coding slice.
3. **Coding agents may be the easiest ICP to reach and the worst one to monetise** — individual developers, not platform teams with budget [R7-a].

**Proposed resolution (to confirm):** use coding agents as the **proving ground**, not necessarily the market. The deterministic oracle makes it the cheapest place on earth to demonstrate that compaction damage is detectable and preventable — and that demonstration is what transfers to the enterprise agent workloads where the money is. Frame the product around **verification we own**, never around one vendor's compaction bug.

### Next action, and why it beats more interviews

We can **generate first-party evidence this week at zero cost**: instrument our own Claude Code sessions, capture state before auto-compact fires, capture behaviour after, and measure what was dropped and whether it changed outcomes. That answers the hardest *technical* question — **is compaction damage automatically detectable?** — with our own data rather than opinion, and the instrumentation is the first real component of the product.

It does **not** replace D0 question 2. Detectability and willingness-to-pay are different questions; only humans outside the company can answer the second.

---

## Thread 9 — Detection is available; enforcement had to move
**Date:** 2026-09-13 · **Decides:** D3, D4 · **Arose from:** specifying Experiment 01

**Checked rather than assumed** (Claude Code hooks reference + local transcript schema):

**Good:** `PreCompact` and `PostCompact` both exist, both carry `transcript_path` and `trigger` (`"manual"`/`"auto"`) with matcher support on trigger. `SessionStart` exposes `source="compact"`. And **ground truth is free** — transcripts are append-only JSONL holding the full history, so compaction shrinks the model's context but **not the file on disk**. We can diff exactly what the model lost, with no reconstruction or estimation.

**Bad, and it hits Thread 2 directly:** **`PreCompact` and `PostCompact` cannot block or modify.** On this ICP we can *detect* compaction damage but not *prevent* compaction. The "own the optimization so the gate has authority" argument does **not** hold via compaction hooks.

**Resolution — the loop survives, relocated:** `PreToolUse` **can** block (exit 2). So the closed loop becomes **capture at `PreCompact` → diff at `PostCompact` → enforce at `PreToolUse`**. If a post-compaction tool call violates a constraint stated before compaction, block the call. This is mechanical, deterministic, and is exactly the PROCTOR pattern of a mechanical check overriding the model [R10-a].

**Landed:** enforcement does not require preventing the optimization — it requires **catching its consequence before it lands**. That generalises beyond Claude Code and is a better architecture than blocking compaction would have been: it gates *effects*, not *mechanisms*, so it survives changes to how any given vendor compacts. Feeds D3.

**Also recorded:** a scan of 41 existing local transcripts found **zero** compaction markers under the obvious key names. Either those sessions never compacted or the marker is named differently — so Experiment 01 must learn the marker from a real captured event rather than hardcoding a guess. Noted so nobody later reads "we checked the transcripts" as "we found compaction data there."

---

## Thread 10 — Round 4 killed the cost thesis outright
**Date:** 2026-09-13 · **Decides:** D1 (all remaining) · **Landed in:** [05-product-plan.md](05-product-plan.md)

**The kill-check nobody had run:** is the cost problem shrinking on its own? **Yes, fast.** Token prices fell ~80% during 2026 and ~1,000× in three years; the frontier index sits 84% below its March 2023 base; 3–5× annual cuts are still forecast through 2027 [R17]. **A cost-optimisation product sells savings into a market whose unit price falls faster than anything it can save.**

Stack that on the four commoditising forces already found — free automatic provider caching [R4-a], TokenPilot open-sourced at 61–87% [R9-a], Atlassian's mcp-compressor at 70–97% [R18-d], and compaction shipped as a first-party API by both OpenAI and Anthropic [R21] — and the cost thesis has **five independent forces against it**.

**Meanwhile the correctness numbers went the other way:** 86–89% of enterprise agent pilots never reach production, with 132 enterprise AI leaders locating the failure in **the runtime layer, not the model** [R18-a]; MAST puts inter-agent misalignment including handoff context loss at **36.9% of 14 failure modes over 1,600+ traces** [R18-b]; 65% of orgs had an agent-caused incident, 41% unintended actions [R18-c]; Gartner expects **40% of enterprises to scale back autonomous agents by 2027** because governance failures only surface post-incident [R18-e]; and **EU AI Act Article 12 logging went live 2 August 2026 with no finalised technical standard** [R20-a].

**Landed — D1 closes as: context integrity for long-running agents.** Cost reduction is demoted to a feature that earns trust and funds the gate. It is never the pitch. Thread 6's open question ("is optimisation the product or the feature?") resolves to **feature**.

**Two findings that made the plan better, not just narrower:**
1. **`pause_after_compaction`** [R21-b] — Anthropic's own docs describe it as *"the safest way to build an agent where compaction is a first-class event rather than a silent background process."* Thread 9's Claude-Code-only design generalises to the API layer, which is where the enterprise money is.
2. **Article 12 is live and unstandardised** [R20-a] — a compaction event is exactly the risk-relevant event nobody logs, the obligation exists now, and incumbents log *outputs*. That is a fallback buyer with a legal deadline if willingness-to-pay on correctness disappoints.

**The uncomfortable finding, recorded so we don't forget it:** "nobody does runtime agent governance" is **false**. OpenBox AI has $5M, a free tier, CopilotKit and Temporal partnerships and healthcare/finserv traction [R19-a]; SAFi, AgentSpec and MI9 exist [R19-b]. **Our entire remaining differentiation is one distinction — they gate *permission*, we gate *epistemics*** — and it is narrow enough that OpenBox could extend into it. Speed and depth on that claim is the whole game.

**Stage 0 is closed.** Everything further is primary research, and the plan rests on two untested assumptions recorded in [05 §9](05-product-plan.md).

---

## Thread 11 — The architecture was Claude-Code-shaped, and that was an error
**Date:** 2026-09-13 · **Decides:** D3, stack · **Landed in:** [07-stack-and-architecture-decisions.md](07-stack-and-architecture-decisions.md)

**Correction raised:** the product is for agents generally, not Claude Code. The previous implementation plan had collapsed "proving ground" into "product", and the stack decision was downstream of that mistake — TypeScript had been chosen *because Claude Code users already have Node*, which is a reason about one client, not about the product.

**Re-derived from Round 5 research. Three findings overturned the design:**

1. **Per-framework integration cannot enforce.** LangChain's dispatcher **discards callback return values**; CrewAI's **78 event kinds are all observe-only**; LlamaIndex is telemetry by design with no return value, exception or mutation reaching the action [R23-a]. **A framework-by-framework strategy ships a dashboard, not a gate.**
2. **The substrate already exists.** AGENT-HOOKS-0.1: 8 interception points, verdicts of **allow/deny/transform**, **fail-closed by specification**, conformance across 8 frameworks (LangGraph, OpenAI Agents SDK, MS Agent Framework, Semantic Kernel, LlamaIndex, CrewAI, Claude Agent SDK), SDKs in 5 languages, 47-scenario conformance kit [R24-a].
3. **It has no context-integrity concept** — the ACS spec "does not address context integrity assurance or memory/compaction event handling" [R24-b].

**Landed:** build **one interceptor against the standard**, not N integrations. Claude Code demotes to one adapter among several, kept first only because it gives free ground truth and a free deterministic oracle.

**The stack was re-decided, not patched.** TypeScript survived — but for a different and better reason: the out-of-process sidecar design makes the core language **invisible to users**, so the binding constraint becomes our own execution speed. Python was the closest rejected alternative and the argument for it is genuinely strong (agent frameworks are Python-dominant; OpenLLMetry has 30+ Python integrations vs ~8 TypeScript; both closest competitors are Python, so PyPI is where practitioners look [R27-a][R25-b][R28]). It is mitigated by shipping a first-class `pip` shim on day one, and the reversal trigger is recorded explicitly: **if Python fluency materially exceeds TypeScript on this team, flip it — nothing else in the architecture changes.**

**Two competitive findings that narrow the moat further, recorded so we do not pretend otherwise:**
- **OWASP Agent Memory Guard** already ships runtime memory-integrity validation with SHA-256 baselines and drop-in middleware for LangChain, LlamaIndex and CrewAI [R28-a].
- **`agent-memory-doctor`** (PyPI) explicitly **"catches silent convention loss"** — very close to our D1 detector [R28-b].

**What is genuinely left to us:** they frame the problem as **adversarial** (poisoning, injection) or run at **boot time**; ours is **non-adversarial mid-session loss caused by the agent's own optimisations**. And none of them runs a **matched control window**, offers a **statistical guarantee**, or verifies **net savings**. That is the whole moat. It is narrow, and it is the honest statement of our position.
