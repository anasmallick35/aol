# Reference — Claude Code transcript format

**Status:** empirical. Established by reading real transcripts during M2, **not** from documentation. Verify before relying on it; Claude Code can change this without notice.
**Consumed by:** `packages/core/src/capture/transcript.ts`

---

## Location

`~/.claude/projects/<slugified-cwd>/<session-id>.jsonl` — append-only JSONL, one JSON object per line.

**Compaction shrinks the model's context, not the file.** That is what makes this exact ground truth for what an agent knew before a mutation, and why Claude Code is the proving ground.

**Caveat:** the file is flushed **asynchronously and lags the live conversation**, so the last turns may be missing when a hook fires, and the final line can be half-written. Authoritative reads happen at `PostCompact`, never `PreCompact`.

## Entry types observed

`user` · `assistant` · `system` · `attachment` · `file-history-snapshot` · `file-history-delta` · `last-prompt` · `mode` · `permission-mode` · `ai-title` · `queue-operation` · `pr-link`

Useful fields: `uuid`, `parentUuid`, `timestamp`, `isSidechain`, `isMeta`, `message.content`, `toolUseResult`, `cwd`, `gitBranch`.

`message.content` is **either a string or an array of blocks** (`{type:'text',text}`, `{type:'thinking'}`, tool blocks). Both shapes must be handled.

## The compaction marker

Earlier guesses — `isCompactSummary` on the boundary, `compactMetadata` as a top-level key, `"source":"compact"` — were **all wrong**, which is why the issue insisted on learning this from a live event rather than hardcoding.

The actual marker is a **system entry with `subtype: "compact_boundary"`**:

```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "content": "Conversation compacted",
  "level": "info",
  "parentUuid": null,
  "logicalParentUuid": "<uuid of the last message before the cut>",
  "compactMetadata": {
    "trigger": "auto",
    "preTokens": 1000160,
    "postTokens": 14120,
    "cumulativeDroppedTokens": 986040,
    "durationMs": 127758,
    "preCompactDiscoveredTools": ["..."],
    "preservedSegment": { "headUuid": "...", "anchorUuid": "...", "tailUuid": "..." },
    "preservedMessages": { "anchorUuid": "...", "uuids": ["...", "..."] }
  }
}
```

**`preservedMessages.uuids` is the most valuable field in the format.** Claude Code states outright which messages survived, so we never infer the surviving set:

```
dropped = { conversational messages before the cut } − preservedMessages.uuids
```

Exact, deterministic, no heuristics.

The boundary is followed by a `user` entry with **`isCompactSummary: true`** — the summary standing in for everything dropped.

## Two traps, both hit in real data

**1. The same compaction appears in several files.** Resuming or forking a session copies earlier boundary records into the new transcript. Across 40 local transcripts there were **3 boundary records but only 2 distinct events**. Counting duplicates inflates every rate we report, so boundaries are deduplicated by content (`logicalParentUuid` + trigger + pre/post tokens), never by position.

**2. A boundary can reference messages that are not in the file.** A resumed session's transcript may open with a boundary whose dropped content lives in the **parent** session's file. Naively that reads as "0 messages dropped" — identical in the data to a clean compaction, and meaning the opposite. Reported explicitly as `groundTruthAvailable: false`.

## Measurements from real events

| | Event A | Event B |
| --- | --- | --- |
| Trigger | auto | auto |
| Tokens | 1,000,160 → 14,120 | 1,000,679 → 21,831 |
| Token drop | **98.6%** | **97.8%** |
| Messages before cut | 2,251 | 2,683 |
| Messages preserved | 19 | 13 |
| **Messages dropped** | **2,231 (99.2%)** | **2,670 (99.5%)** |
| Characters dropped | 212,001 | 415,518 |
| Surviving chars (preserved + summary) | 21,749 | 26,687 |
| **Compression** | **9.7×** | **15.6×** |
| Compaction duration | 127.8 s | 140.8 s |

**~99% of messages leave the agent's context at every compaction, replaced by a summary an order of magnitude smaller.** Whether anything that *mattered* was among them is the question M3–M5 exist to answer — this is the scale of the haystack, not evidence of loss.
