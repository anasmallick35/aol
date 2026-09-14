# ContextKeep — Product Plan v1

**Status:** PROPOSED. Committing to a direction, with the two assumptions it rests on stated explicitly and the consequences of being wrong written down.
**Inputs:** [00-brief](00-project-brief.md) · [01-research (Rounds 1–4)](01-research-findings.md) · [02-decisions](02-fundamentals-decision-log.md) · [03-debate](03-decision-debate-log.md) · [04-experiment-01](04-experiment-01-compaction-detectability.md)
**Supersedes:** the v1.0 vision doc's ten-engine scope, and brief §2's cost-reduction framing.

---

## 0. The blunt strategic read

Stage 0 produced one asymmetry that decides everything:

**Cost optimisation is collapsing as a business.** Token prices fell ~80% in 2026 and ~1,000× in three years, with 3–5× annual cuts still forecast through 2027 [R17]. On top of that, every lever we would have sold is now free: provider prompt caching is automatic at 90% off [R4-a], TokenPilot open-sourced cache-aware compaction at 61–87% reduction [R9-a], Atlassian open-sourced MCP compression at 70–97% [R18-d], and both OpenAI and Anthropic shipped compaction as a first-party API [R21]. **Five commoditising forces at once, against a unit price falling faster than anything we could save.**

**Correctness is exploding as a problem.** 86–89% of enterprise agent pilots never reach production, and a survey of 132 enterprise AI leaders located the failure in **the runtime layer, not the model** [R18-a]. MAST catalogued 14 failure modes over 1,600+ traces, with **inter-agent misalignment — including context loss at handoffs — at 36.9%** [R18-b]. 65% of organisations had an agent-caused incident last year; 41% involved unintended actions [R18-c]. Gartner expects **40% of enterprises to scale back autonomous agents by 2027 because governance failures only surface after incidents** [R18-e]. And EU AI Act Article 12 event logging went into **full application on 2 August 2026, with no finalised technical standard** [R20-a].

**Therefore: we are not building a cost product.** Cost reduction becomes a feature that earns trust and funds the gate — never the pitch.

---

## 1. What we are building

> **A context-integrity layer for long-running agents: it proves that when an agent's context was mutated, nothing that mattered was lost — and blocks the actions that would follow if it was.**

Positioning: **the flight recorder and circuit breaker for agent context.** Not "Cloudflare for AI inference" — that framing describes the commoditising layer and collides with Cloudflare AI Gateway [R3-a].

**Naming — RESOLVED (Thread 12, 2026-09-14):** "AI Optimization Layer" named the thing the market is giving away, so the product ships as **ContextKeep** — `contextkeep` on npm, `contextkeep-hooks` on PyPI. `aol` survives only as the private repo name.

### The one-sentence differentiation

Every runtime-governance product gates on **permission** — *is this agent allowed to do this?* Nobody found in Round 4 gates on **epistemics** — *does this agent still know what it needed to know?* [R19]

---

## 2. What we are explicitly NOT building

Deferred, not forgotten. Anything here re-entering scope must go through the debate log first.

| Not in v1 | Why |
| --- | --- |
| Model routing | Hardest lever, last step of the playbook. RouterArena exists if we ever want to prove it [R3-c] |
| Semantic cache | Highest quality risk of any lever — ~15% false-positive rate, documented cross-tenant leak [R2-b]. Shipping it early makes us the thing we sell protection against |
| General LLM observability | ClickHouse/Langfuse, Braintrust ($800M), Arize (1T spans/mo) in a $2.69B market [R3-d]. Unwinnable for two people |
| Task-outcome correctness ("did the agent do the right thing") | Unbounded, and it is Braintrust/Arize/LangSmith territory [R3-d] |
| Prompt rewriting / compression as a product | TokenPilot and mcp-compressor are free [R9-a][R18-d] |
| Our own provider abstraction | LiteLLM covers 100+ providers [R3-a] |
| Compliance certifications | Process-bound, 12+ months, later phase |

---

## 3. The product, concretely

### The two gates

**Gate 1 — Integrity.** At every context-mutation event (compaction, eviction, compression, cache hit), prove that task-critical state survived: stated constraints, open commitments, workspace facts, decisions. Deterministic diff against ground truth.

**Gate 2 — Net benefit.** Prove the saving actually happened. Non-trivial and unowned: prompt caching needs an exact prefix match, so any prompt rewrite **destroys the 90% cached-input discount downstream** [R8-a]. A naive optimiser cuts tokens 40% and raises the bill. We measure savings *net of cache effects*, in dollars.

### The loop

```
  capture ──────────► verify ──────────► enforce ──────────► attest
  pre-mutation        deterministic      block the           immutable,
  state snapshot      diff + bounds      violating action    exportable log
```

**We never perform the compaction, and we never block it.** The response ladder is **prevent → detect → repair → block → report**, taking the highest rung the adapter supports; blocking is the floor, not the plan, and reporting is unconditional. Full specification and the adapter capability matrix in [06 §4.5](06-implementation-plan.md).

**Enforcement gates effects, not mechanisms** (Thread 9). We do not prevent compaction — we catch its consequences before they land. That survives any vendor changing *how* they compact, which matters now that compaction is first-party infrastructure [R21].

### Detectors — deterministic first, judge advisory

Mechanical: constraint survival · artifact survival (file paths, commands, errors, branches) · open-commitment survival · redundant-work detection · **constraint violation** (post-mutation tool call breaking a pre-mutation rule).

An LLM judge is **advisory only and may never override a mechanical verdict** — the prescription from *LLM-as-a-Judge Is Not an Oracle*, which catalogued 11 evaluation-signal failures including agents scoring 100% by reading cached answer keys while true capability was 68% [R10-a]. This also structurally resolves the "we grade our own homework" conflict: deterministic gates are customer-auditable, LLM judges are not.

**On coding agents the oracle is free** — tests, compiler, type checker, linter. Deterministic checks cost ~zero and catch **26% of failures LLM-judge baselines miss** [R15-a].

### The guarantee

Conformal risk control gives **distribution-free, finite-sample guarantees**: error rate on accepted outputs below a chosen threshold with high probability [R11-a]. Factorized Active Querying delivers the same confidence interval at **up to 5× fewer queries** [R11-b], and a small judge costs ~$1.01/1K evaluations [R2-a]. So the claim is contractual, not rhetorical:

> **"Context-integrity degradation bounded at ≤ε with probability ≥1−δ. Savings verified net of cache effects. Full evidence trail."**

Buyers are explicitly complaining about "SLAs that avoid real operational guarantees" [R11-d]. No competitor found in Stage 0 makes a statistical guarantee.

---

## 4. Integration surfaces

Adopt the **PDP/PEP split** from access control (XACML) — control plane decides, inline enforcement points act [R19-b]. Do not invent an architecture.

| Surface | Mechanism | Role |
| --- | --- | --- |
| **Claude Code hooks** | `PreCompact` → `PostCompact` → `PreToolUse` (exit 2 blocks) | **Proving ground.** Ground truth is free: transcripts are append-only JSONL, so compaction shrinks context but not the file |
| **Anthropic Messages API** | `compact_20260112` + custom `instructions` + **`pause_after_compaction`** | **The real product.** Anthropic's own docs call pause *"the safest way to build an agent where compaction is a first-class event rather than a silent background process"* [R21-b] — an officially supported inspect-and-augment hook |
| **OpenAI Responses API** | `context_management` + `compact_threshold` | Second provider [R21-a] |
| **Telemetry** | Emit OTel `gen_ai.*` spans | Datadog, Langfuse, Arize ingest natively [R5-c] — interoperate with the observability incumbents rather than compete |

**Latency is not a constraint.** The model call takes 50–1000× longer than any gateway overhead [R5-a]. That slack is what makes in-path verification viable.

---

## 5. Decisions, resolved

| # | Decision | Rationale |
| --- | --- | --- |
| **D1 Wedge** | **Context integrity for long-running agents** | Cost is commoditising from five directions [R17][R4-a][R9-a][R18-d][R21]; correctness has an 89% failure rate and a runtime-layer diagnosis [R18-a] |
| **D2 ICP** | **Coding agents as proving ground; platform teams running long-horizon production agents as market** | Free oracle makes coding the cheapest place to prove detectability [R15-a]; budget and the $400K/year pain sit with platform teams [R7-a][R1-a] |
| **D3 Integration** | **Hybrid: hooks + compaction-API middleware, PDP/PEP split** | Gate effects not mechanisms; survives vendor change [R21][R19-b] |
| **D4 Quality method** | **Deterministic-first, judge advisory, conformal bounds, sampled** | 11 documented judge failures [R10-a]; conformal gives real guarantees [R11-a]; FAQ makes it 5× cheaper [R11-b] |
| **D5 Pricing** | **Flat platform fee + usage tier. NOT % of savings** | Free provider caching makes the counterfactual contestable [R4-a]; and a guarantee's value is avoided incidents, not dollars saved. Anchors: $30–60/user/month for flat enterprise seats, hybrid now dominant, pure per-seat fell 21%→15% [R22-c] |
| **D6 Build vs integrate** | **Build: the integrity gate, violation engine, attestation log. Integrate: everything else** | TokenPilot [R9-a], LiteLLM [R3-a], LLMLingua [R4-e], OTel [R5-c], mcp-compressor [R18-d] are all free and better than what two people would write |
| **D7 Enterprise readiness** | **Day one: tenancy/namespacing, immutable audit log, retention controls. Later: SOC 2, ISO 42001, EU AI Act conformity, SSO, RBAC depth** | Namespacing is a *correctness* boundary — the documented cache leak was a global namespace [R2-b]. **Article 12 logging is already in force with no standard written** [R20-a], so the audit log is day-one and is a differentiator, not a chore |

---

## 6. Distribution

**Open-core, following Langfuse** — open source from the start, "core expanding, periphery shrinking," with OSS credited for integration velocity across LangChain, LiteLLM and OTel [R22-a]. LiteLLM's 40K stars and Langfuse's ClickHouse acquisition are the same story [R3-a][R3-d].

- **Open source:** the detectors, the transcript/diff tooling, the Claude Code hooks. Developers adopt a tool that tells them their agent silently forgot something.
- **Commercial:** the control plane, the conformal guarantee, the tamper-evident attestation log, multi-tenant policy, cross-team reporting.

The OSS half is also Experiment 01's instrumentation. **We ship the experiment.**

---

## 7. Roadmap

Scope here is much narrower than the brief's original ten-engine v1, so the brief's 4–5 month figure does not apply. Estimates below are for **this** scope, two people, implementation via Claude Code.

| Phase | Output | Estimate |
| --- | --- | --- |
| **P1 — Capture + detect** | Claude Code hooks, event store, deterministic detectors, local report CLI | **~2 weeks** |
| **P2 — Enforce** | `PreToolUse` blocking on violations; `pause_after_compaction` middleware for the Anthropic API | **~1–1.5 weeks** |
| **P3 — Guarantee** | Conformal bounds, tamper-evident attestation log, Article 12-shaped export | **~2–3 weeks** |
| **P4 — Platform** | Multi-tenant control plane, policy management, second provider | later |

**Shippable OSS tool with enforcement: ~3–4 weeks. Add the guarantee layer: ~6 weeks total.** Enterprise compliance certification remains a separate 12+ month process — that is procedural, not engineering, and is unchanged.

Implementation detail in [06-implementation-plan.md](06-implementation-plan.md).

## 8. Honest competitive position

| Competitor | Overlap | Our edge | Their edge |
| --- | --- | --- | --- |
| **OpenBox AI** ($5M seed, CopilotKit + Temporal, healthcare/finserv traction) | High — runtime governance, enforcement at action time, audit trails, crypto proofs [R19-a] | They gate **permission**; we gate **epistemics**. Nobody is checking whether the agent still *knows* what it needed | Funded, shipping, partnered, free tier |
| **SAFi / AgentSpec / MI9** | Deterministic gating, audit logging, declarative policy [R19-b] | Context-integrity detectors and the statistical guarantee | OSS mindshare |
| **Braintrust / Arize / Langfuse** | Evaluation | We block in-path; they report | Enormous funding and distribution |
| **Anthropic / OpenAI** | `pause_after_compaction`, `instructions` [R21] | We are provider-neutral and adversarial to our own optimisations | **They can close this at any time** |

**The honest summary: our differentiation is one distinction — epistemic integrity vs. permission — and it is narrow enough that OpenBox could extend into it.** Speed and depth on that specific claim are the whole game.

---

## 9. Two assumptions this plan rests on

Stated plainly, because everything above fails if either is wrong.

**A1 — Compaction damage is mechanically detectable.** Not yet proven. Experiment 01 tests it with pre-registered kill conditions. **If false, there is no product** — no gate, no guarantee, no pricing. The plan does not survive; it converts to a research project or we stop.

**A2 — Someone outside this company will pay for proof.** Not tested. The only "yes" is from a founder about their own idea, which is worth nothing [Thread 8]. **If false but A1 holds**, the OSS detector still has value and the fallback is the compliance angle — Article 12 logging is mandatory *now*, with no standard written [R20-a], which is a buyer with a legal deadline rather than a preference.

**Both are cheap to test and neither is tested. That is the honest state of this plan.**

---

## 10. What would change this plan

| Signal | Change |
| --- | --- |
| Experiment 01 hits any kill condition | Stop. Reopen D1 |
| Damage real but inconsequential | Drop to visibility-only; that is a feature, not a company — reconsider whether to proceed |
| Anthropic/OpenAI ship integrity verification natively | Pivot to provider-neutral multi-agent handoffs, where MAST puts 36.9% of failures [R18-b] |
| OpenBox ships context integrity | Compete on the guarantee (conformal bounds) and the coding-agent oracle, or reconsider |
| D0 conversations say cost still outranks correctness | Re-weight toward Gate 2 (verified net savings), which is the cost story we *can* defend |

---

## 11. Immediate next actions

1. **Run Experiment 01.** Nothing downstream is real until A1 is answered.
2. **Book 5–10 external conversations** in parallel. Lead with a measured claim from the experiment, never with "would you pay for proof?"
3. **Do not write the PRD yet.** Stage 2 is gated on A1. Writing it first is exactly the out-of-order failure the brief warns about.
