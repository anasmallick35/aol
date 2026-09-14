import { streamTranscript, isConversational, extractText, type CompactBoundary, type TranscriptEntry } from './transcript.js'

/**
 * The slice of a transcript around one compaction.
 *
 * `dropped` is what the agent could see before the cut and cannot see after.
 * `preserved` is what survived. `summaryText` is what replaced the dropped
 * content. Detectors ask one question of these three: did anything that
 * mattered in `dropped` fail to appear in `preserved` or `summaryText`?
 */
export interface MutationWindows {
  /** Messages before the cut that were NOT carried through. */
  dropped: TranscriptEntry[]
  /** Messages before the cut that WERE carried through. */
  preserved: TranscriptEntry[]
  /** The compaction summary that stands in for everything dropped. */
  summaryText: string
  /**
   * Matched control window: the conversational messages immediately before the
   * cut, regardless of whether they survived.
   *
   * Not optional bookkeeping. Agents re-read files and drop threads as a matter
   * of course, so without a baseline "the agent forgot something" is
   * indistinguishable from "the agent behaved normally", and every rate we
   * report is meaningless.
   */
  control: TranscriptEntry[]
  /**
   * False when the transcript does not contain the messages this boundary
   * refers to — which happens on a resumed session, where the dropped content
   * lives in the parent session's file.
   *
   * Reported rather than silently treated as "nothing was dropped", because
   * those two states look identical in the data and mean opposite things.
   */
  groundTruthAvailable: boolean
}

export interface WindowOptions {
  /** How many messages before the cut form the control window. */
  controlSize?: number
}

/**
 * Control window size, in messages.
 *
 * Raised from 40 after running against real events: a 40-message window
 * contained no user constraints at all, so the control column read "no
 * comparable items" and the constraint numbers had nothing to be judged
 * against. 200 is still small beside a 2,600-message dropped set, but large
 * enough to usually contain some.
 *
 * When the control still yields too few items to compare, the report says so
 * rather than comparing anyway.
 */
export const DEFAULT_CONTROL_SIZE = 200

/**
 * Slice a transcript around a compaction boundary.
 *
 * Second pass over the file. Deliberately not merged with boundary discovery:
 * finding boundaries touches only system entries and stays cheap, and most
 * transcripts have no boundary at all, so the expensive pass usually never runs.
 */
export async function sliceWindows(
  path: string,
  boundary: CompactBoundary,
  opts: WindowOptions = {},
): Promise<MutationWindows> {
  const controlSize = opts.controlSize ?? DEFAULT_CONTROL_SIZE
  const preservedSet = new Set(boundary.preservedUuids)

  const before: TranscriptEntry[] = []
  for await (const entry of streamTranscript(path)) {
    if (entry.lineIndex >= boundary.lineIndex) break
    if (isConversational(entry)) before.push(entry)
  }

  const preserved = before.filter((e) => e.uuid !== undefined && preservedSet.has(e.uuid))
  const dropped = before.filter((e) => e.uuid === undefined || !preservedSet.has(e.uuid))

  return {
    dropped,
    preserved,
    summaryText: boundary.summaryText ?? '',
    control: before.slice(-controlSize),
    // A boundary that names preserved messages none of which appear in this
    // file is describing a conversation we cannot see.
    groundTruthAvailable: before.length > 0 && (boundary.preservedUuids.length === 0 || preserved.length > 0),
  }
}

/** Concatenated text of a set of entries, for containment checks by detectors. */
export function windowText(entries: TranscriptEntry[]): string {
  return entries.map((e) => extractText(e.message?.content)).join('\n')
}

/** Everything the agent can still see after the cut: survivors plus the summary. */
export function survivingText(w: MutationWindows): string {
  return [windowText(w.preserved), w.summaryText].filter(Boolean).join('\n')
}
