# ContextKeep — Stack & Architecture Decisions

**Status:** DECIDED. Supersedes the stack section of [06-implementation-plan.md](06-implementation-plan.md), which was written around a Claude-Code-only design and was wrong.
**Evidence:** [01-research-findings.md](01-research-findings.md), Rounds 1–5.
**Format:** every decision records options considered, the choice, the reasoning, **why each alternative was rejected in detail**, and what would reverse it.

---

## 0. What Round 5 changed

The previous plan treated Claude Code hooks as the architecture. That was an error — the product is for agents generally. Re-deriving from evidence produced three findings that overturn the earlier design:

1. **Per-framework SDK integration cannot enforce.** LangChain discards callback return values; CrewAI's 78 event kinds are all observe-only; LlamaIndex is telemetry by design. Only OpenAI Agents SDK and Claude Code can block [R23-a]. **A framework-by-framework strategy ships a dashboard, not a gate.**
2. **A framework-neutral enforcement substrate already exists.** AGENT-HOOKS-0.1: 8 interception points, verdicts of allow/deny/transform, **fail-closed by specification**, conformance demonstrated across 8 frameworks, SDKs in 5 languages, 47-scenario conformance kit [R24-a].
3. **It has no concept of context integrity.** The ACS spec "does not address context integrity assurance or memory/compaction event handling" [R24-b].

So: **stop building integrations, start building the one interceptor the standard is missing.**

---

## A. Architecture decisions

### A1 — Build on AGENT-HOOKS-0.1 as the primary integration substrate

**Decision:** implement a context-integrity **interceptor** against AGENT-HOOKS-0.1, rather than N framework integrations.

**Why:** it delivers LangGraph, OpenAI Agents SDK, Microsoft Agent Framework, Semantic Kernel, LlamaIndex, CrewAI and Claude Agent SDK in one implementation [R24-a]; interceptors can **deny and transform**, which is the enforcement capability that per-framework callbacks cannot give us [R23-a]; and fail-closed is specified rather than left to us — a host that can't reach us, times us out, or gets a malformed verdict **must synthesise a deny**. That is the correct default for a safety gate and we get it for free.

| Rejected | Why rejected |
| --- | --- |
| **Per-framework SDK integrations** | Cannot enforce in most frameworks [R23-a]. Also an unbounded maintenance tax — Microsoft names it "the per-framework integration tax" and built the standard to kill it |
| **LLM proxy / gateway** | Sees API traffic, not agent-loop structure. Cannot tell which calls form one task, which are retries, which are parallel branches without heuristics. Also puts us in the hot path and head-to-head with LiteLLM, Portkey, Cloudflare [R3-a] — a fight we lose. **Retained as a later adapter, not the foundation** |
| **OTel collector processor** | Telemetry is one-way. Spans arrive after the fact, so it can observe but never block. Good for reporting, useless as a gate. **Adopted for output, rejected for control** |
| **eBPF / network interception** | Sees bytes, not semantics. Enormous complexity for no access to agent-loop meaning |

**Reverses if:** Agent Hooks adoption stalls. The npm package is **`0.1.0-alpha.2`** and ships a **linux-x64-only** native core (verified in M6), so this is even earlier than the spec write-up implied. Mitigation is A2, strengthened: our adapters transcribe the contract from the published `.d.ts` and import nothing from the SDK at runtime.

**One contract detail worth recording, because it differs from the write-up:** the spec has **three** decisions, not five — `allow`, `deny`, `transform`. `warn` is an allow carrying `warnings[]`; `escalate` is a deny carrying an `approval` block. Our internal five-valued verdict collapses into this deliberately, in one mapping function per adapter, tested in both languages.

### A2 — Adapter-agnostic core, multiple adapters

**Decision:** the core knows nothing about Agent Hooks. It consumes a normalised internal event and returns a verdict. Adapters translate.

```
 Agent Hooks adapter ─┐
 Claude Code adapter ─┤
 Proxy adapter ───────┼──► normalised event ──► CORE ──► verdict ──► adapter translates back
 OTel adapter (out) ──┘
```

**Why:** it hedges the 0.1-spec risk directly. If Agent Hooks stalls, we swap adapters and keep the product. It also lets Claude Code ship first as the proving ground [05 §D2] without contaminating the architecture.

**Rejected:** coupling the core to Agent Hooks types — faster this month, fatal if the spec churns or dies.

### A3 — Out-of-process local sidecar, not an in-process library

**Decision:** the core runs as a local daemon; adapters are thin shims that forward the interception context over a Unix domain socket (TCP fallback on Windows).

| Rejected | Why rejected |
| --- | --- |
| **In-process library per language** | Would require reimplementing detection, extraction, storage and statistics in Python, TypeScript, .NET, Go and Rust. For two people that is the end of the project |
| **Remote/cloud service** | Ships customer prompts off-machine. For a product whose pitch is integrity, that is the single worst possible default. Local-only removes every adoption objection at once |

**Why the latency is acceptable:** a UDS round-trip is sub-millisecond, and model calls take **50–1000× longer than any gateway overhead** [R5-a]. The gateway throughput benchmarks in [R26] — LiteLLM's Rust migration taking per-request overhead from 7.5ms to 0.05ms — describe a **high-throughput hot-path proxy**, which is not our workload. We make one decision per interception point. **Those numbers do not transfer and must not drive our choices.**

### A4 — Ground truth by capture-and-diff, not by trusting the host

**Decision:** snapshot the pre-mutation state ourselves and diff it against post-mutation state. Never rely on the framework to report what it dropped.

**Why:** frameworks compact independently and uncoordinatedly — only AutoGen centralises it [R4-c] — and none report what was lost. Where a full transcript exists (Claude Code JSONL), use it as exact ground truth: compaction shrinks the model's context, not the file on disk.

**Rejected:** asking the framework what changed. Nothing implements it, and a gate that trusts the thing it is auditing is not a gate.

### A5 — Emit standards, invent nothing

| Output | Standard | Why |
| --- | --- | --- |
| Telemetry | **OTel `gen_ai.*`** | Datadog, Langfuse and Arize ingest natively [R5-c] — we interoperate with observability incumbents instead of fighting Braintrust/Arize/Langfuse, which we cannot outspend [R3-d] |
| Attestation (P3) | **TRACE-shaped evidence** | Linux Foundation governance, CoSAI technical workstream, composes RFC 9711 (EAT), RFC 9334 (RATS), SCITT, SLSA, SPIFFE, EAR — the standards an auditor already asks for. ~135K PyPI downloads in 10 weeks [R25-a] |
| Compliance export | **EU AI Act Article 12 shape** | In full application since **2 August 2026**, deployers must retain logs ≥6 months, **and no technical standard is finalised** [R20-a] |

**Rejected:** a bespoke audit format. It would be strictly worse, unauditable by third parties, and obsolete the moment TRACE or prEN 18229-1 lands.

### A6 — Deterministic-first, judge-advisory, control-window mandatory

Unchanged from [05 §3] and non-negotiable: mechanical detectors decide; an LLM judge may only advise and can never override a mechanical verdict [R10-a]; and every detector runs against a **matched control window**, because agents re-read files and drop threads normally and without a baseline the numbers are meaningless.

**This is also a competitive necessity.** OWASP Agent Memory Guard and `agent-memory-doctor` already exist [R28-a][R28-b] — the latter explicitly "catches silent convention loss." Our remaining distinctions are narrow and should be stated plainly: they frame the problem as **adversarial** (poisoning/injection) or run at **boot time**; ours is **non-adversarial mid-session loss caused by the agent's own optimisations**; and none of them runs a control window, offers a statistical guarantee, or verifies net savings.

---

## B. Stack decisions

### S1 — Core language: **TypeScript on Node 22 LTS**

This is the closest call in the document and the one most worth revisiting.

| Option | For | Against | Verdict |
| --- | --- | --- | --- |
| **TypeScript** | Our team's strongest language, and **execution speed is the binding constraint** for two people targeting 3–4 weeks. Full parity in Agent Hooks and AGT SDKs [R24-c]. npm distribution. A3 makes the core language invisible to users | Not where most agent frameworks live. No native statistics ecosystem | ✅ **Chosen** |
| **Python** | Where the agents are — Python dominates agent development, ~300K-package ML ecosystem, OpenLLMetry has **30+ Python integrations vs ~8 TypeScript** [R27-a][R25-b]. Native home for P3 statistics. Both closest competitors are Python, so it is where practitioners look [R28-a][R28-b] | Slower for us to write well. Daemon packaging is worse than a Node binary | ❌ Rejected — **but see reversal** |
| **Go** | Single static binary, ideal daemon ergonomics, the OTel collector ecosystem's language, Agent Hooks Go SDK exists | Neither of us is fluent. Weak statistics story for P3 | ❌ Rejected on team fluency |
| **Rust** | Fastest; LiteLLM chose a Rust core [R26-a]; Agent Hooks Rust SDK exists | We are not a high-throughput gateway (A3), so the performance argument does not apply to our workload. Slowest to write — fatal for a 3–4 week target | ❌ Rejected — solving a problem we don't have |
| **Polyglot (Rust/Go core + per-language bindings)** | Best long-term performance and reach | Multiplies build, packaging and CI complexity across five targets. Wrong shape for two people at v1 | ❌ Rejected as premature |

**On the statistics objection:** conformal risk control is a quantile over a calibration set — roughly a hundred lines of arithmetic, not a deep library dependency [R11-a]. Porting beats splitting the stack.

**On the discoverability objection (the strongest argument for Python):** mitigated by shipping a first-class `pip`-installable Python shim on day one (S3), so PyPI searchers find us even though the core is TypeScript.

**Reverses if:** either of us is materially more productive in Python than TypeScript, or P3 turns out to need statistical machinery beyond conformal thresholds. In the second case the fix is a Python sidecar **for the guarantee layer only** — never for the interception path.

### S2 — Runtime & tooling

| Need | Choice | Rejected |
| --- | --- | --- |
| Runtime | **Node 22 LTS** | **Bun** — faster, but less stable for a long-lived daemon and weaker native-module story. **Deno** — good sandboxing, smallest ecosystem of the three |
| Build | **tsup** | `tsc` alone (no bundling), `webpack` (wrong era for a CLI) |
| Test | **vitest** | `jest` (slower, heavier TS config), `node:test` (thinner assertions/mocking) |
| Validation | **zod** | Hand-rolled guards — interception payloads are untrusted input; **parse, don't assume** |
| CLI | **commander** | `oclif` (too heavy), `yargs` (weaker types) |
| Lint | **oxlint** | ESLint — 50–100× slower on equivalent rulesets [R26-c] and we gain nothing from the plugin ecosystem here |

### S3 — Adapters and distribution

| Adapter | Package | Role |
| --- | --- | --- |
| **Python** | `pip install contextkeep-hooks` | **First-class, day one.** Where the agents are [R27-a], and where competitors are discovered [R28-a][R28-b] |
| **TypeScript** | `npm i @contextkeep/hooks` | Second ecosystem; OpenAI Agents SDK TS did ~1.5M downloads in 30 days [R27-a] |
| **Claude Code** | `npx contextkeep init` | Proving ground — the free deterministic oracle [R15-a] and free ground truth (A4) |
| **Core daemon** | `npx contextkeep` / standalone binary | Language-invisible to users (A3) |

Each shim is deliberately thin: normalise the interception context, call the socket, return the verdict. **All detection logic lives in the core**, so a shim is a few hundred lines and stays cheap to add.

Licence: **MIT**, open-core per [05 §6]. OSS: detectors, adapters, store, report. Commercial later: control plane, conformal guarantee, attestation, multi-tenant policy.

### S4 — Storage: **SQLite (`better-sqlite3`) at `~/.contextkeep/contextkeep.db`**

Synchronous API suits a daemon with short critical sections; zero configuration; queryable for the report; a single file the user can inspect or delete — which matters for a product selling integrity.

**Rejected:** `node:sqlite` (still experimental on Node 22); JSONL-only (no joins for cross-session reporting); Postgres or any server (operational burden, and nothing should leave the machine in v1); DuckDB (analytically better, worse as an embedded transactional store for this).

### S5 — Transport: **Unix domain socket, length-prefixed JSON**

Sub-millisecond, no port conflicts, filesystem permissions as the access-control model. TCP on loopback as the Windows fallback.

**Rejected:** **gRPC** — protobuf toolchain across five shim languages for no benefit at this scale. **HTTP/1.1** — viable, kept as a debug-mode fallback, but adds per-call overhead we don't need. **stdio subprocess per call** — process startup per interception is the one place our latency budget genuinely would not survive.

### S6 — What we integrate rather than build

Per [05 §5, D6]: LiteLLM for provider abstraction [R3-a] · TokenPilot-class cache-aware compaction, open source, 61–87% reduction [R9-a] · LLMLingua for compression [R4-e] · `mcp-compressor` for MCP tool bloat, 70–97% [R18-d] · OTel for telemetry · Agent Hooks SDKs for adapters · TRACE for attestation.

**We build exactly one thing: the context-integrity gate** — extraction, survival diffing, control-window comparison, violation predicates, and the evidence trail. Everything else is a dependency.

---

## C. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **AGENT-HOOKS is earlier than 0.1 suggests** — the npm package is **`0.1.0-alpha.2`**, and it ships a napi-rs Rust core with **only `agent-hooks.linux-x64-gnu.node`**: there is no darwin-arm64 build, so it cannot even load on our machines (verified M6) | **High — raised** | A2 adapter-agnostic core, plus: our adapters declare the contract **locally** and take **no runtime dependency** on the SDK. They satisfy `Interceptor` structurally, so they install and run wherever the host does |
| **Microsoft extends ACS into context integrity** | High | It is the one gap they left [R24-b]. Speed, plus depth they are unlikely to copy: control windows and conformal bounds |
| **OWASP Agent Memory Guard extends from poisoning into loss** | Medium-high | Same answer. Also different framing: they are security, we are correctness |
| **TypeScript core limits Python-ecosystem credibility** | Medium | First-class `pip` shim day one (S3) |
| **Detection proves not to work** | **Fatal** | This is assumption A1 in [05 §9] and remains untested — the experiment was deprioritised by decision, not by evidence |

---

## D. Reversal triggers

| Trigger | Change |
| --- | --- |
| Agent Hooks adoption stalls or the spec churns badly | Fall back to Claude Code + proxy adapters; core unaffected (A2) |
| P3 needs heavy statistics | Python sidecar for the guarantee layer only, never the interception path |
| Python fluency materially exceeds TypeScript on the team | Flip S1; A3 means nothing else in this document changes |
| Enforcement proves impossible via Agent Hooks in practice | Proxy adapter becomes primary; accept the hot-path cost and the incumbent fight |
