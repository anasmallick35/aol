import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'

/**
 * Reader for Claude Code transcripts.
 *
 * The transcript is append-only JSONL: compaction shrinks the model's context
 * but never the file. That makes it exact ground truth for what an agent knew
 * before a mutation, which is why Claude Code is the proving ground.
 *
 * The format here was established empirically from real transcripts, not from
 * documentation. Earlier guesses at the marker name were all wrong; see the M2
 * issue for what was actually found.
 */

/** Entry types we care about. Others are skipped without parsing further. */
export type EntryType = 'user' | 'assistant' | 'system' | 'attachment' | string

export interface TranscriptEntry {
  type: EntryType
  uuid?: string
  parentUuid?: string | null
  timestamp?: string
  isSidechain?: boolean
  isMeta?: boolean
  /** Marks the summary message that replaced everything dropped. */
  isCompactSummary?: boolean
  subtype?: string
  message?: { role?: string; content?: unknown }
  toolUseResult?: unknown
  /** 0-based position in the file, for slicing. */
  lineIndex: number
}

/**
 * A compaction event, as Claude Code records it.
 *
 * `preservedUuids` is the part that matters most: Claude Code states outright
 * which messages survived, so we never have to infer the surviving set. The
 * dropped set is therefore exactly "messages before the cut that are not in
 * this list".
 */
export interface CompactBoundary {
  lineIndex: number
  /** The last message before the cut. */
  logicalParentUuid?: string
  trigger: string
  preTokens?: number
  postTokens?: number
  cumulativeDroppedTokens?: number
  durationMs?: number
  preservedUuids: string[]
  anchorUuid?: string
  /** Text of the summary that replaced the dropped content, if present. */
  summaryText?: string
}

interface RawSystemEntry {
  subtype?: string
  logicalParentUuid?: string
  compactMetadata?: {
    trigger?: string
    preTokens?: number
    postTokens?: number
    cumulativeDroppedTokens?: number
    durationMs?: number
    preservedMessages?: { anchorUuid?: string; uuids?: string[] }
  }
}

export const COMPACT_BOUNDARY_SUBTYPE = 'compact_boundary'

/**
 * Stream a transcript line by line.
 *
 * Never read the whole file: real transcripts run to thousands of lines and
 * megabytes. Malformed lines are skipped rather than thrown — a partially
 * written last line is normal, because the transcript is flushed
 * asynchronously and may lag the live conversation.
 */
export async function* streamTranscript(path: string): AsyncGenerator<TranscriptEntry> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  let lineIndex = 0
  try {
    for await (const line of rl) {
      const i = lineIndex++
      if (!line.trim()) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      if (parsed && typeof parsed === 'object') {
        yield { ...(parsed as Omit<TranscriptEntry, 'lineIndex'>), lineIndex: i }
      }
    }
  } finally {
    rl.close()
  }
}

/** Stable identity for a compaction event, used to deduplicate. */
export function boundaryKey(b: CompactBoundary): string {
  return createHash('sha256')
    .update([b.logicalParentUuid ?? '', b.trigger, b.preTokens ?? '', b.postTokens ?? ''].join('|'))
    .digest('hex')
    .slice(0, 16)
}

/**
 * Find every compaction boundary in a transcript.
 *
 * Deduplicates by content rather than position. Resuming or forking a session
 * copies earlier boundary records into the new transcript, so the same physical
 * compaction can appear in several files — counting those twice would inflate
 * every rate we report.
 */
export async function findCompactBoundaries(path: string): Promise<CompactBoundary[]> {
  const out: CompactBoundary[] = []
  const seen = new Set<string>()
  let pending: CompactBoundary | undefined

  for await (const entry of streamTranscript(path)) {
    // The summary message follows its boundary; attach it, then move on.
    if (pending) {
      if (entry.isCompactSummary === true) {
        pending.summaryText = extractText(entry.message?.content)
        pending = undefined
      } else if (entry.type === 'user' || entry.type === 'assistant') {
        pending = undefined
      }
    }

    if (entry.type !== 'system' || entry.subtype !== COMPACT_BOUNDARY_SUBTYPE) continue

    const raw = entry as unknown as RawSystemEntry
    const meta = raw.compactMetadata ?? {}
    const boundary: CompactBoundary = {
      lineIndex: entry.lineIndex,
      logicalParentUuid: raw.logicalParentUuid,
      trigger: meta.trigger ?? 'unknown',
      preTokens: meta.preTokens,
      postTokens: meta.postTokens,
      cumulativeDroppedTokens: meta.cumulativeDroppedTokens,
      durationMs: meta.durationMs,
      preservedUuids: meta.preservedMessages?.uuids ?? [],
      anchorUuid: meta.preservedMessages?.anchorUuid,
    }

    const key = boundaryKey(boundary)
    if (seen.has(key)) {
      pending = undefined
      continue
    }
    seen.add(key)
    out.push(boundary)
    pending = boundary
  }

  return out
}

/** Flatten a message content field to plain text. Content may be a string or a block array. */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block)
    } else if (block && typeof block === 'object') {
      const b = block as { type?: string; text?: string }
      if (typeof b.text === 'string') parts.push(b.text)
    }
  }
  return parts.join('\n')
}

/** Messages that carry meaning for a human reader; excludes sidechains and bookkeeping. */
export function isConversational(entry: TranscriptEntry): boolean {
  return (entry.type === 'user' || entry.type === 'assistant') && !entry.isSidechain && !entry.isMeta
}
