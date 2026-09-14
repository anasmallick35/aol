/**
 * Synthetic transcripts shaped from real Claude Code output.
 *
 * Built rather than checked in as sample files: real transcripts contain the
 * user's actual work, and this repo is not the place for it. Every field here
 * mirrors what was observed in real data during M2.
 */

export interface FixtureMessage {
  uuid: string
  role: 'user' | 'assistant'
  text: string
  sidechain?: boolean
  meta?: boolean
}

export function msg(uuid: string, role: 'user' | 'assistant', text: string, extra: Partial<FixtureMessage> = {}): FixtureMessage {
  return { uuid, role, text, ...extra }
}

function messageLine(m: FixtureMessage, i: number): string {
  return JSON.stringify({
    type: m.role,
    uuid: m.uuid,
    parentUuid: i === 0 ? null : `m${i - 1}`,
    timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
    isSidechain: m.sidechain ?? false,
    ...(m.meta ? { isMeta: true } : {}),
    message: {
      role: m.role,
      content: m.role === 'assistant' ? [{ type: 'text', text: m.text }] : m.text,
    },
  })
}

export interface BoundarySpec {
  trigger?: string
  preTokens?: number
  postTokens?: number
  cumulativeDroppedTokens?: number
  durationMs?: number
  preservedUuids: string[]
  logicalParentUuid?: string
  summaryText?: string
}

export function boundaryLine(b: BoundarySpec): string {
  return JSON.stringify({
    parentUuid: null,
    logicalParentUuid: b.logicalParentUuid ?? 'm-last',
    isSidechain: false,
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    level: 'info',
    compactMetadata: {
      trigger: b.trigger ?? 'auto',
      preTokens: b.preTokens ?? 1_000_160,
      postTokens: b.postTokens ?? 14_120,
      cumulativeDroppedTokens: b.cumulativeDroppedTokens ?? 986_040,
      durationMs: b.durationMs ?? 127_758,
      preCompactDiscoveredTools: ['Read', 'Edit'],
      preservedSegment: {
        headUuid: b.preservedUuids[0] ?? '',
        anchorUuid: b.preservedUuids[0] ?? '',
        tailUuid: b.preservedUuids.at(-1) ?? '',
      },
      preservedMessages: { anchorUuid: b.preservedUuids[0] ?? '', uuids: b.preservedUuids },
    },
  })
}

export function summaryLine(text: string): string {
  return JSON.stringify({
    type: 'user',
    uuid: 'summary-1',
    parentUuid: null,
    isCompactSummary: true,
    timestamp: new Date(1_700_000_900_000).toISOString(),
    message: { role: 'user', content: `This session is being continued from a previous conversation...\n\nSummary: ${text}` },
  })
}

/** A transcript with `before` messages, one boundary, then `after` messages. */
export function buildTranscript(opts: {
  before: FixtureMessage[]
  boundary?: BoundarySpec
  summary?: string
  after?: FixtureMessage[]
  extraBoundary?: BoundarySpec
}): string {
  const lines: string[] = opts.before.map(messageLine)
  if (opts.boundary) {
    lines.push(boundaryLine(opts.boundary))
    if (opts.summary !== undefined) lines.push(summaryLine(opts.summary))
  }
  for (const [i, m] of (opts.after ?? []).entries()) lines.push(messageLine(m, opts.before.length + i))
  if (opts.extraBoundary) lines.push(boundaryLine(opts.extraBoundary))
  return lines.join('\n') + '\n'
}
