import { dedupe, type ExtractedItem } from './types.js'
import { extractConstraints } from './constraints.js'
import { extractArtifacts, type ArtifactOptions } from './artifacts.js'
import { extractCommitments } from './commitments.js'
import type { TranscriptEntry } from '../capture/transcript.js'

export * from './types.js'
export * from './constraints.js'
export * from './artifacts.js'
export * from './commitments.js'

export interface ExtractOptions extends ArtifactOptions {}

/** Everything that ought to survive a mutation, deduplicated. */
export function extractAll(entries: TranscriptEntry[], opts: ExtractOptions = {}): ExtractedItem[] {
  return dedupe([
    ...extractConstraints(entries),
    ...extractArtifacts(entries, opts),
    ...extractCommitments(entries),
  ])
}
