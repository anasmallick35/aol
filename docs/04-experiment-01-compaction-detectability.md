# Experiment 01 — Is compaction damage automatically detectable?

**Status:** SPEC — not yet run.
**Decides:** the technical precondition for the whole product. Feeds D1, D4.
**Cost:** ~zero (local scripts + hooks). Optional LLM extraction ≤ $5 total.
**Timebox:** 7 days passive collection + 1 day analysis. **Hard stop at 14 days** regardless of sample.

---

## 1. Why this experiment and not interviews

We already know the pain is real and noticed — that is closed [R13][R14]. What we do **not** know is whether the damage can be caught **automatically, mechanically, and in time to matter.** If it can't, there is no product, and everything downstream (the gate, the guarantee, the pricing) is void.

This is the cheapest possible way to find that out, it uses data we generate anyway, and the instrumentation is the first real component of what we would ship. **It runs in parallel with — not instead of — the D0 conversations.** Detectability and willingness-to-pay are different questions.

---

## 2. Question and hypotheses

**Question:** after an auto-compaction event, can a deterministic detector identify information loss that subsequently changes agent behaviour — without a human noticing first, and without knowing the task outcome in advance?

**H1 (loss is measurable):** a non-trivial fraction of task-relevant items present before compaction are absent from the post-compaction context.

**H2 (loss has consequences):** post-compaction, the agent measurably violates constraints or redoes work it had already completed, at a rate significantly above the pre-compaction baseline.

**H3 (loss is cheaply detectable):** the signal in H1/H2 is visible to **deterministic** detectors, without an LLM judge in the loop.

H3 is the one that matters commercially. H1 alone is a paper; H1+H2+H3 is a product.

---

## 3. Pre-registered kill conditions

**Written before running, because we are the most motivated observers possible.** If any fires, we say so in the debate log and reconsider D1 — we do not go looking for a subgroup where it worked.

| # | Kill condition | Why it kills |
| --- | --- | --- |
| **K1** | Constraint-violation rate post-compaction is **< 5%** of events **and** artifact survival is **> 95%** | Damage too rare/small to build a company on |
| **K2** | Deterministic detectors (§6, D1–D4) find **no signal**, and only an LLM judge on every event finds anything | Violates the deterministic-first architecture [R10-a]; economics collapse |
| **K3** | Detector flag rate post-compaction is **statistically indistinguishable** from the pre-compaction control window (§7) | We are measuring normal agent behaviour, not compaction damage |
| **K4** | Damage is only identifiable **after** knowing the task failed | Post-hoc explanation, not detection. Nothing to gate on |
| **K5** | Fewer than **10 auto-compaction events** captured in 14 days across both of us | Either the pain is rarer than we think, or our own usage is unrepresentative. Both are findings |

**K5 is not a failure of the experiment — it is a result.** Report it as one.

---

## 4. Verified instrumentation surface

Checked against the Claude Code hooks reference, not assumed:

| Hook | Fields | Blocks? | Our use |
| --- | --- | --- | --- |
| `PreCompact` | `session_id`, `transcript_path`, `cwd`, `trigger` (`"manual"`\|`"auto"`) — matcher on trigger | **No** | Snapshot pre-state. Match on `auto` only |
| `PostCompact` | same + `trigger` | **No** | Snapshot post-state, trigger the diff |
| `SessionStart` | `source` includes `"compact"` | No | Catch compaction-initiated sessions |
| `InstructionsLoaded` | `reason` includes `"compact"` | No | Record whether CLAUDE.md was reloaded on compaction (a confound — see §8) |
| `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id` | **Yes (exit 2)** | **Violation detection, and later enforcement** |
| `PostToolUse` | `tool_output` | No | Behavioural signal (redundant re-reads) |

**Two findings from verifying this, both important beyond the experiment:**

1. **`PreCompact`/`PostCompact` cannot block or modify.** On Claude Code we can *detect* compaction damage but not *prevent* compaction. The "gate with authority" thesis from Thread 2 does **not** hold via compaction hooks on this ICP.
2. **But `PreToolUse` can block (exit 2).** So the closed loop is still available, just relocated: **capture at `PreCompact` → diff at `PostCompact` → enforce at `PreToolUse`.** If a post-compaction tool call violates a constraint stated before compaction, we block the call. That is a real, mechanical, deterministic gate on the ICP with the free oracle — and it is exactly the PROCTOR pattern of a mechanical check overriding the model [R10-a].

**Ground truth is free.** Transcripts are append-only JSONL at `~/.claude/projects/<project-hash>/*.jsonl` holding the **full** history. Compaction shrinks the model's context; it does **not** shrink the file. So the pre-compaction truth remains on disk and we can diff exactly what the model lost. No reconstruction, no estimation.

**Known caveat:** the transcript is written **asynchronously and may lag** the in-memory conversation — at `PreCompact` the last turns may be missing. Mitigation: do the authoritative read at `PostCompact`, using `PreCompact` only to record the cut point (timestamp + last `uuid` seen).

**Schema confirmed locally** (7,781-line session): line `type` ∈ {`user`, `assistant`, `attachment`, `system`, `file-history-snapshot`, `file-history-delta`, `last-prompt`, `mode`, …}; useful fields `uuid`, `parentUuid` (conversation DAG), `timestamp`, `promptId`, `toolUseResult`, `isSidechain`, `cwd`, `gitBranch`.

**Unverified:** how a compaction event marks itself in the JSONL. A scan of 41 existing local transcripts found **zero** compaction markers under the obvious key names — meaning either those sessions never compacted, or the marker is named differently. **Step 0 of the run is to capture one real event and learn the marker empirically.** Do not hardcode a guess.

---

## 5. What we capture

At `PreCompact` (trigger=`auto`): `session_id`, `transcript_path`, `cwd`, `gitBranch`, wall-clock, last observed `uuid`, transcript line count, byte size.
At `PostCompact`: the same, plus the new post-compaction context as it appears in the transcript.
Continuously: every `PreToolUse` and `PostToolUse` (`tool_name`, `tool_input`, `tool_use_id`, truncated output hash), tagged pre- or post-compaction.

Everything lands as append-only JSONL in a local `aol-exp01/` directory. **No content leaves the machine.** Optional LLM extraction (§6, D5) runs on constraint text only, and only with explicit per-session opt-in.

---

## 6. Detectors — deterministic first, judge last

Each returns a number per compaction event. **D1–D4 are mechanical. D5 is advisory only and may never override D1–D4** [R10-a].

| ID | Detector | Mechanism | Measures |
| --- | --- | --- | --- |
| **D1** | **Constraint survival** | Extract imperative statements from *user* turns before the cut (modal/imperative patterns: "always", "never", "don't", "make sure", "before you", "use X not Y"). Check literal-or-normalised presence in post-compaction context | H1 — did stated rules survive? |
| **D2** | **Artifact survival** | Exact sets, no NLP: file paths touched, commands run, error strings, test names, git branch. Pre-set vs. post-set | H1 — did hard facts survive? |
| **D3** | **Todo survival** | Incomplete `TaskCreate`/todo items before the cut that are absent after | H1 — strongest deterministic signal; the data is already structured |
| **D4** | **Redundant work** | Post-compaction `Read`/`Grep`/`Bash` calls whose exact target was already read pre-compaction, with no intervening write | H2 — the agent re-deriving what it knew. Deterministic, and it is the mechanical form of "my agent is lagging" |
| **D5** | **Constraint violation** | For each D1 constraint, a mechanical predicate where one exists (e.g. "never edit `X`" → `PreToolUse` on `Edit` with `file_path == X`). Count post-compaction violations | **H2 — the money metric.** Direct measurement of governance decay [R14-b] |
| **D6** | *(advisory)* LLM judge | Small judge (~$1.01/1K [R2-a]) asked whether a dropped item was task-relevant | Calibration only — measures how much D1–D5 miss. **Never authoritative** |

**D5 is the headline number.** It is deterministic, it is denominated in observable rule-breaking, and it is precisely what the Governance Decay literature measures — so our result is comparable to published baselines instead of being self-graded.

---

## 7. Control — the step that stops us fooling ourselves

Every detector also runs on a **matched pre-compaction window**: the same number of turns immediately *before* the cut point, where no compaction occurred.

Agents re-read files and drop threads normally. Without this baseline, D4 in particular will produce an impressive number that means nothing. **If post ≈ pre, K3 fires.**

Second control: **manual compactions** (`trigger="manual"`) are recorded but analysed separately. They carry user-supplied preservation instructions and are not the failure mode we care about.

---

## 8. Threats to validity — state them now

| Threat | Handling |
| --- | --- |
| **n=2, and it's us.** Our sessions are not a random sample of agent workloads | Report as directional only. Never present as market evidence |
| **Task heterogeneity.** Some sessions compact during trivial work, some mid-refactor | Record task type; report distribution, don't average it away |
| **CLAUDE.md reload confound.** If `InstructionsLoaded` fires with `reason="compact"`, some constraints are restored by a mechanism unrelated to compaction quality | Log it; segment results by whether it fired |
| **Observer effect.** Knowing we're measuring changes how we prompt | Collect passively for the full week before looking at any result |
| **Detector overfitting.** Tuning D1 patterns until the number looks good | Freeze detector definitions before analysis. Changes after unblinding get logged as a *second*, clearly-labelled analysis |
| **Async transcript lag** | Authoritative read at `PostCompact`; `PreCompact` only records the cut point |

---

## 9. Sample and analysis

**Target: 30 auto-compaction events across ≥10 distinct sessions, both of us.** At a true violation rate near 25%, n=30 gives roughly ±16% at 95% — enough to separate "common" from "rare", which is the only distinction this decision needs. **This is a directional experiment, not a publishable one.** Do not over-claim precision.

**Report per event:** D1–D5 as rates, each against its matched control window. **Report in aggregate:** distribution (not just mean) of each detector; the correlation between D1/D3 loss and D4/D5 consequence; and the fraction of events where *any* deterministic detector fired while D6 found nothing, plus the reverse — that ratio is the empirical answer to H3.

---

## 10. What a result means

| Outcome | Read | Next |
| --- | --- | --- |
| D5 violations in ≥25% of events, clearly above control | **Strong go.** Damage is real, consequential, mechanically detectable | Build the `PreToolUse` enforcement arm; take the number into the D0 conversations as a concrete claim |
| D1/D3 loss high, D4/D5 consequence low | Loss is real but mostly harmless | Wedge weakens to "visibility", which is a feature, not a company. Reconsider D1 |
| Deterministic detectors quiet, D6 finds damage | **K2.** The gate needs a judge on every event | Economics and the deterministic-first architecture both break. Serious rethink |
| Everything at control level | **K3.** We were measuring normal agent behaviour | Kill the compaction wedge |
| <10 events in 14 days | **K5.** Rarer than assumed, or we are unrepresentative | Report honestly; re-scope to heavier workloads |

---

## 11. What this builds toward

Not throwaway. The constraint extractor (D1), the artifact differ (D2), the todo tracker (D3) and the violation predicate engine (D5) are **the v1 gate**. The experiment is the first commit, not a detour.

It also produces the one thing the D0 conversations currently lack: **a concrete, measured claim to react to.** "Would you pay for proof?" is a bad question. *"In our data, N% of auto-compactions silently dropped a constraint you had stated, and in M% the agent then violated it — would you want that caught?"* is a real one.
