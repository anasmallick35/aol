import { extractAll, type ExtractOptions } from '../extract/index.js'
import { detectSurvival, type SurvivalSummary } from './survival.js'
import { detectRedundancy, type RedundancySummary } from './redundancy.js'
import { windowText, survivingText, type MutationWindows } from '../capture/window.js'
import type { TranscriptEntry } from '../capture/transcript.js'

export * from './survival.js'
export * from './redundancy.js'

export interface DetectionReport {
  /** D1–D3 over the mutation itself. */
  constraints: SurvivalSummary
  artifacts: SurvivalSummary
  commitments: SurvivalSummary
  /** D4 over the mutation itself. */
  redundancy: RedundancySummary
  /**
   * The same measurements over a window where NO mutation occurred.
   *
   * Every headline number must be read against this column. An agent drops
   * threads and re-reads files as a matter of course; a loss rate that matches
   * the control is evidence of normal behaviour, not of compaction damage.
   */
  control: {
    constraints: SurvivalSummary
    artifacts: SurvivalSummary
    commitments: SurvivalSummary
    redundancy: RedundancySummary
  }
  groundTruthAvailable: boolean
}

/**
 * Build the control by splitting the pre-cut window in half and asking the same
 * question of it: do items mentioned in the first half still appear in the
 * second? That measures how quickly things fall out of the conversation
 * naturally, with no compaction involved.
 */
function controlHalves(control: TranscriptEntry[]): { first: TranscriptEntry[]; second: TranscriptEntry[] } {
  const mid = Math.floor(control.length / 2)
  return { first: control.slice(0, mid), second: control.slice(mid) }
}

export function detect(
  windows: MutationWindows,
  after: TranscriptEntry[] = [],
  opts: ExtractOptions = {},
): DetectionReport {
  const dropped = extractAll(windows.dropped, opts)
  const surviving = survivingText(windows)

  const byKind = (kind: string) => dropped.filter((i) => i.kind === kind)

  const { first, second } = controlHalves(windows.control)
  const controlItems = extractAll(first, opts)
  const controlText = windowText(second)
  const controlByKind = (kind: string) => controlItems.filter((i) => i.kind === kind)

  return {
    constraints: detectSurvival(byKind('constraint'), surviving),
    artifacts: detectSurvival(byKind('artifact'), surviving),
    commitments: detectSurvival(byKind('commitment'), surviving),
    redundancy: detectRedundancy(windows.dropped, after, opts),
    control: {
      constraints: detectSurvival(controlByKind('constraint'), controlText),
      artifacts: detectSurvival(controlByKind('artifact'), controlText),
      commitments: detectSurvival(controlByKind('commitment'), controlText),
      redundancy: detectRedundancy(first, second, opts),
    },
    groundTruthAvailable: windows.groundTruthAvailable,
  }
}
