# AOL — Implementation Plan

**Status:** LOCKED for build. **Rewritten after Round 5** — the previous version was built around Claude Code hooks and was wrong.
**Stack and architecture rationale:** [07-stack-and-architecture-decisions.md](07-stack-and-architecture-decisions.md). This doc is the build sequence.
**Scope:** P1 + P2 — a framework-neutral context-integrity gate that detects context loss and blocks its consequences.

---

## 1. Shape

One adapter-agnostic **core daemon**, thin **adapters** that speak to it, per [07 §A2–A3].

```
  ┌───────────────── adapters (thin) ─────────────────┐
  │ Python shim  │ TS shim  │ Claude Code │ (proxy)   │
  │ agent-hooks  │ agent-   │ hooks       │  later    │
  │              │ hooks    │             │           │
  └──────┬───────┴────┬─────┴──────┬──────┴───────────┘
         └────────────┴────────────┘
                      │  UDS, length-prefixed JSON
              ┌───────▼────────┐
              │   AOL CORE     │   normalise → capture → detect → verdict
              │  (TypeScript)  │   SQLite at ~/.aol/aol.db
              └───────┬────────┘
                      ├──► verdict: allow | warn | deny | transform
                      └──► OTel gen_ai.* spans
```

**Coverage from day one via AGENT-HOOKS-0.1:** LangGraph, OpenAI Agents SDK, Microsoft Agent Framework, Semantic Kernel, LlamaIndex, CrewAI, Claude Agent SDK [R24-a]. Claude Code is an additional adapter, used as the proving ground because it gives free ground truth and a free deterministic oracle.

---

## 2. Repository

```
aol/
├─ packages/
│  ├─ core/                      # TypeScript daemon — all logic lives here
│  │  └─ src/
│  │     ├─ server.ts            # UDS listener, framing, verdict protocol
│  │     ├─ events.ts            # normalised internal event model (adapter-agnostic)
│  │     ├─ capture/
│  │     │  ├─ snapshot.ts       # pre-mutation state capture
│  │     │  ├─ transcript.ts     # streaming JSONL reader (Claude Code ground truth)
│  │     │  └─ window.ts         # pre/post slices + matched control window
│  │     ├─ extract/
│  │     │  ├─ constraints.ts    # imperative statements from user turns
│  │     │  ├─ artifacts.ts      # file paths, commands, errors, branches
│  │     │  └─ commitments.ts    # open todos / task items
│  │     ├─ detect/
│  │     │  ├─ survival.ts       # D1–D3
│  │     │  ├─ redundancy.ts     # D4
│  │     │  ├─ violation.ts      # D5 — the headline metric
│  │     │  └─ index.ts
│  │     ├─ verdict.ts           # allow | warn | deny | transform; fail-closed
│  │     ├─ store/               # better-sqlite3 + migrations + typed queries
│  │     ├─ telemetry/otel.ts    # gen_ai.* span emission
│  │     └─ report/render.ts
│  ├─ cli/                       # npx @aol/cli — init, report, doctor, daemon
│  └─ adapter-agent-hooks-ts/    # npm @aol/hooks
│     # NOTE: Claude Code hook dispatch lives in packages/cli as `aol hook`,
│     # not in its own package. Claude Code invokes hooks as shell commands,
│     # so the adapter is a dispatcher, and a second package would add
│     # publishing overhead with no user benefit. The Agent Hooks adapters in
│     # M6 DO get their own packages — they are imported as libraries into a
│     # user's agent code, which is a different shape.
├─ python/
│  └─ aol_hooks/                 # pip aol-hooks — agent-hooks Interceptor → UDS
├─ test/fixtures/                # anonymised transcript + interception fixtures
└─ README.md
```

Monorepo is justified here — four publishable artefacts sharing one protocol — but every package stays thin except `core`.

---

## 3. Data model

```sql
sessions(id TEXT PRIMARY KEY, adapter TEXT, framework TEXT, cwd TEXT,
         git_branch TEXT, first_seen INTEGER, last_seen INTEGER)

events(id INTEGER PRIMARY KEY, session_id TEXT, kind TEXT,       -- 'mutation' | 'control'
       mutation_type TEXT,                                        -- 'compaction'|'eviction'|'truncation'|'cache_hit'
       trigger TEXT, cut_ref TEXT, cut_ts INTEGER,
       pre_tokens INTEGER, post_tokens INTEGER, created_at INTEGER)

items(id INTEGER PRIMARY KEY, event_id INTEGER, phase TEXT,      -- 'pre' | 'post'
      kind TEXT,                                                  -- 'constraint'|'artifact'|'commitment'
      value TEXT, norm TEXT, hash TEXT, source_ref TEXT)

detections(id INTEGER PRIMARY KEY, event_id INTEGER, detector TEXT,
           severity TEXT, item_id INTEGER, detail TEXT)

violations(id INTEGER PRIMARY KEY, event_id INTEGER, constraint_id INTEGER,
           interception_point TEXT, tool_name TEXT, tool_input TEXT,
           verdict TEXT, ts INTEGER)
```

`norm` holds the canonical form (lowercased, whitespace-collapsed, paths absolutised) so survival checks are exact-match on a canonical string, never fuzzy.

---

## 4. Detectors

Unchanged in substance; now fed by normalised events from any adapter. All mechanical; the judge is advisory only and cannot override a mechanical verdict [R10-a].

| ID | Detector | Mechanism |
| --- | --- | --- |
| **D1** | Constraint survival | Imperative/modal patterns in user turns before the cut (`always`, `never`, `don't`, `make sure`, `before you`, `use X not Y`) — present after? |
| **D2** | Artifact survival | Exact sets: file paths, commands, error strings, test names, branch. Pre minus post |
| **D3** | Commitment survival | Incomplete todo/task items before the cut, absent after. Already structured — strongest signal |
| **D4** | Redundant work | Post-cut reads/searches whose exact target was already read pre-cut, with no intervening write |
| **D5** | **Constraint violation** | Mechanical predicates from D1 constraints (`never edit X` → tool call with `path == X`). **Headline metric**, and the only detector wired to `deny` |

**The matched control window is mandatory, not optional** — same detectors over the N interceptions immediately before the cut. Agents re-read files and drop threads normally; without the baseline D4 produces an impressive number that means nothing. The report always shows both columns.

Detector definitions freeze before we look at aggregate output. Changes afterwards ship as a separate, labelled analysis.

---

## 4.5 What happens when loss is detected — the response ladder

**We do not perform the compaction.** The framework or provider does. We sit around it. The goal is **not "compaction that removes nothing"** — that is a contradiction, since compaction exists precisely because the context is full. The goal is **nothing *important* removed, and proof of it.**

Five rungs, in order. We take the highest one the adapter supports.

| # | Rung | When | Mechanism |
| --- | --- | --- | --- |
| **1** | **Prevent** | Before the mutation | Inject preservation instructions so the loss never happens. Anthropic's `compact_20260112` accepts custom `instructions` guiding what the summary must retain [R21-b]. Cheapest rung — nothing to repair if nothing is dropped |
| **2** | **Detect** | At the mutation | Snapshot pre-state, diff post-state, run D1–D5 against the matched control window. Always runs, on every adapter |
| **3** | **Repair** | At the pause / transform point | Re-inject the critical dropped items into the compacted context, then continue. Enabled by `pause_after_compaction: true` — *"the model will pause after generating the compaction summary, allowing you to inspect or process it before continuing"* [R21-b] — and by the AGENT-HOOKS `transform` verdict [R24-a] |
| **4** | **Block** | At the consequence | Only when repair is impossible. We do **not** block the compaction — we deny the *tool call that violates a constraint which was lost*. Gating effects, not mechanisms (Thread 9) |
| **5** | **Report** | Always | What was dropped, what was repaired, what was blocked, and the token/cache cost of the repair. Unconditional — the user always learns what happened to their context |

### Why "block and stop" is not the design

Blocking alone leaves the user stuck with a damaged agent and no path forward. Rung 4 exists as a **floor**, not the plan. On any adapter that supports `transform`, the normal path is **detect → repair → continue**, with the user told what was restored.

### Three honest limits

1. **Repair has a token budget.** Re-injecting dropped items costs context. Compaction fired because context was full, so the critical set may not fit. When it doesn't, we cannot repair — we escalate to the human (`escalate` verdict in ACS [R24-b]) rather than silently proceeding.
2. **Repair is not free — it breaks the prompt cache.** Modifying the compacted prefix invalidates the exact-prefix match and forfeits the 90% cached-input discount on everything downstream [R8-a]. So repair trades cache savings for integrity. **This is precisely what Gate 2 exists to measure**, and the report must show the trade explicitly rather than hiding it.
3. **Not every adapter can repair.** Capability differs, and we must not overclaim:

| Adapter | Prevent | Detect | Repair | Block | Report |
| --- | --- | --- | --- | --- | --- |
| **Anthropic API** (`compact_20260112`) | ✅ `instructions` | ✅ | ✅ `pause_after_compaction` | ✅ | ✅ |
| **Agent Hooks host** | ⚠️ host-dependent | ✅ | ✅ `transform` verdict | ✅ `deny` | ✅ |
| **Claude Code hooks** | ⚠️ via `CLAUDE.md` only | ✅ | ❌ **`PreCompact`/`PostCompact` cannot modify** | ✅ `PreToolUse` exit 2 | ✅ |
| **OpenAI Responses API** | ⚠️ threshold only | ✅ | ⚠️ to verify | ✅ | ✅ |

**Claude Code is detect-block-report only.** It cannot repair inline — which is another reason it is the proving ground and not the product.

---

## 5. Milestones

| # | Deliverable | Done when | Est. |
| --- | --- | --- | --- |
| **M1** | Core daemon skeleton: UDS server, framing, normalised event model, verdict protocol, SQLite store, **fail-closed default** | A synthetic adapter drives an interception end-to-end and a deny is honoured | 3 d ✅ |
| **M2** | Claude Code adapter + transcript reader | A real auto-compaction is captured end-to-end; the compaction marker is identified **empirically** | 2 d ✅ |
| **M3** | Extractors: constraints, artifacts, commitments | Run over existing local transcripts; output is inspectable and sane | 3 d |
| **M4** | Detectors D1–D4 + control window; `aol report` | Per-event loss rates print against control | 3 d |
| **M5** | D5 violation detection | A real post-mutation violation is caught and shown | 2 d |
| **M6** | Agent Hooks adapters (Python + TypeScript) | LangGraph and CrewAI sample agents run through the gate | 4 d |
| **M7** | Enforcement: `deny`/`transform` verdicts, `--warn` / `--block` modes | A violating tool call is blocked with a clear message | 3 d |
| **M8** | Packaging: `npx @aol/cli`, `pip install aol-hooks`, `npm i @aol/hooks`, README, public repo | A stranger installs in one command and gets a report | 3 d |

**P1 (M1–M5): ~13 days. P2 (M6–M7): ~7 days. With packaging: ~4 weeks calendar for two people.**

**M2 carries the only hard unknown:** a scan of 41 existing local transcripts found **zero** compaction markers under the obvious key names. Either those sessions never compacted or the marker is named differently, so M2 learns it from a live event rather than hardcoding a guess. Do not parallelise M3–M5 ahead of M2.

**Sequencing note:** M2–M5 use Claude Code because its free ground truth makes detector development fastest. M6 proves the same detectors work adapter-agnostically. If M6 slips, we have shipped a Claude Code tool — useful, but not the product.

---

## 6. Resources and cost

| Item | Cost |
| --- | --- |
| Runtime, libraries, SQLite, Agent Hooks SDKs (MIT) | $0 |
| Hosting | $0 — nothing leaves the machine in v1 |
| GitHub, npm, PyPI | $0 |
| LLM spend | $0 in P1/P2; P3 advisory judge ≈ $1.01/1K evaluations [R2-a] |
| **Total to shipped OSS tool** | **≈ $0 plus our time** |

No infrastructure, no accounts, no telemetry. Local-only is the trust argument for a product whose pitch is integrity.

---

## 7. P3 — guarantee layer (specified, not built yet)

- **Conformal risk control** over a calibration set: threshold τ such that error on accepted outputs ≤ε with probability ≥1−δ [R11-a]. Ported to TypeScript — a quantile computation, not a library dependency.
- **Sampling:** 5–20% routine; Factorized Active Querying gives equivalent confidence at up to 5× fewer queries [R11-b][R11-c].
- **Advisory judge** (~$1.01/1K [R2-a]) **only** to calibrate what D1–D5 miss. Mechanical rejection always overrides LLM approval [R10-a].
- **Attestation:** hash-chained append-only log emitting **TRACE-shaped evidence** [R25-a], exportable in EU AI Act Article 12 shape — in force since 2 August 2026, no technical standard finalised [R20-a].

---

## 8. Conventions

- **Fail-closed is the default**, per AGENT-HOOKS-0.1: unreachable, timed-out or malformed verdicts become a deny. Every other error path in an adapter must degrade to a logged `allow` rather than crashing a user's agent — and that asymmetry is deliberate and documented.
- Core decision budget: **under 50ms** per interception. Heavy detection runs on the mutation event, never in the tool path.
- **Hook registration stays minimal.** Claude Code spawns a process per hook, measured at ~157ms (≈102ms node startup + ≈55ms npx resolution). `aol init` registers compaction and session events only; per-tool hooks fire on every tool call and are added in M4/M5, when their data is consumed. Any new hook registration must justify its per-invocation cost.
- **No network calls in P1/P2.** Enforced in review, not merely intended.
- Every detector ships with fixture tests before it counts as done.
- Conventional commits; GitHub issues mirror §5 one-to-one.
