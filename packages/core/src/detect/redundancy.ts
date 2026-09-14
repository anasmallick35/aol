import { type TranscriptEntry } from '../capture/transcript.js'
import { extractArtifacts } from '../extract/artifacts.js'

/**
 * D4: work the agent redid because it forgot it had already done it.
 *
 * The mechanical form of "my agent is lagging" — re-reading a file it read
 * before the cut, with nothing having changed in between. Unlike D1–D3 this
 * needs no judgement about paraphrase: either the exact target was read before
 * and read again, or it wasn't.
 *
 * WHY THE CONTROL MATTERS MORE HERE THAN ANYWHERE ELSE: agents re-read files
 * constantly and for good reasons. Without a baseline this detector produces an
 * impressive number that means nothing at all.
 */

export interface RedundantRead {
  target: string
  subtype: string
  /** Entry where it was first read. */
  firstRef?: string
  /** Entry where it was read again. */
  repeatRef?: string
}

export interface RedundancySummary {
  /** Distinct targets read before the cut. */
  priorTargets: number
  /** Targets read again afterwards with no intervening write. */
  redundant: RedundantRead[]
  /** redundant / priorTargets. */
  rate: number
}

const READ_SUBTYPES = new Set(['file'])

/**
 * Targets whose content the agent changed. A re-read after a write is not
 * redundant — it is correct behaviour, and counting it would be a bug.
 */
function writtenTargets(entries: TranscriptEntry[]): Set<string> {
  const written = new Set<string>()
  for (const entry of entries) {
    const content = entry.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue
      const b = block as { type?: string; name?: string; input?: Record<string, unknown> }
      if (b.type !== 'tool_use') continue
      if (b.name !== 'Edit' && b.name !== 'Write' && b.name !== 'NotebookEdit') continue
      const p = b.input?.file_path ?? b.input?.path
      if (typeof p === 'string') written.add(p.toLowerCase())
    }
  }
  return written
}

export function detectRedundancy(
  before: TranscriptEntry[],
  after: TranscriptEntry[],
  opts: { cwd?: string } = {},
): RedundancySummary {
  const priorItems = extractArtifacts(before, opts).filter((i) => READ_SUBTYPES.has(i.subtype))
  const priorByNorm = new Map(priorItems.map((i) => [i.norm, i]))

  const afterItems = extractArtifacts(after, opts).filter((i) => READ_SUBTYPES.has(i.subtype))
  const written = writtenTargets(after)

  const redundant: RedundantRead[] = []
  const counted = new Set<string>()

  for (const item of afterItems) {
    if (!priorByNorm.has(item.norm)) continue
    if (counted.has(item.norm)) continue
    // A re-read after modifying the file is correct, not redundant.
    if ([...written].some((w) => w.toLowerCase().includes(item.norm) || item.norm.includes(w))) continue
    counted.add(item.norm)
    redundant.push({
      target: item.value,
      subtype: item.subtype,
      ...(priorByNorm.get(item.norm)?.sourceRef ? { firstRef: priorByNorm.get(item.norm)!.sourceRef } : {}),
      ...(item.sourceRef ? { repeatRef: item.sourceRef } : {}),
    })
  }

  return {
    priorTargets: priorByNorm.size,
    redundant,
    rate: priorByNorm.size ? redundant.length / priorByNorm.size : 0,
  }
}
