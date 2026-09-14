import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findCompactBoundaries, streamTranscript, boundaryKey, extractText, isConversational, COMPACT_BOUNDARY_SUBTYPE } from '../src/capture/transcript.js'
import { buildTranscript, msg } from './fixtures/transcript.js'

let dir: string
const write = (name: string, content: string) => {
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aol-tx-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('streamTranscript', () => {
  it('yields entries with their line index', async () => {
    const p = write('t.jsonl', buildTranscript({ before: [msg('m0', 'user', 'hello'), msg('m1', 'assistant', 'hi')] }))
    const entries = []
    for await (const e of streamTranscript(p)) entries.push(e)
    expect(entries.map((e) => e.lineIndex)).toEqual([0, 1])
    expect(entries[0]!.type).toBe('user')
  })

  it('skips a malformed trailing line instead of throwing', async () => {
    // The transcript is flushed asynchronously, so a half-written final line is
    // normal rather than exceptional.
    const p = write('t.jsonl', buildTranscript({ before: [msg('m0', 'user', 'hi')] }))
    appendFileSync(p, '{"type":"user","uuid":"m1","mess')
    const entries = []
    for await (const e of streamTranscript(p)) entries.push(e)
    expect(entries).toHaveLength(1)
  })

  it('skips blank lines', async () => {
    const p = write('t.jsonl', '\n' + buildTranscript({ before: [msg('m0', 'user', 'hi')] }) + '\n\n')
    const entries = []
    for await (const e of streamTranscript(p)) entries.push(e)
    expect(entries).toHaveLength(1)
  })
})

describe('findCompactBoundaries', () => {
  it('finds a boundary and reads its metadata', async () => {
    const p = write(
      't.jsonl',
      buildTranscript({
        before: [msg('m0', 'user', 'never edit prod.ts'), msg('m1', 'assistant', 'understood')],
        boundary: { preservedUuids: ['m1'], preTokens: 1_000_160, postTokens: 14_120, logicalParentUuid: 'm1' },
        summary: 'Earlier work on the parser.',
      }),
    )
    const [b] = await findCompactBoundaries(p)
    expect(b).toBeDefined()
    expect(b!.trigger).toBe('auto')
    expect(b!.preTokens).toBe(1_000_160)
    expect(b!.postTokens).toBe(14_120)
    expect(b!.preservedUuids).toEqual(['m1'])
    expect(b!.logicalParentUuid).toBe('m1')
    expect(b!.summaryText).toContain('Earlier work on the parser.')
  })

  it('returns nothing for a transcript with no compaction', async () => {
    const p = write('t.jsonl', buildTranscript({ before: [msg('m0', 'user', 'hi')] }))
    expect(await findCompactBoundaries(p)).toEqual([])
  })

  it('deduplicates the same compaction appearing twice', async () => {
    // Resuming or forking a session copies earlier boundary records into the
    // new transcript. Counting the same physical compaction twice would inflate
    // every rate we report — observed in real data, where 3 records were only
    // 2 distinct events.
    const spec = { preservedUuids: ['m1'], preTokens: 500, postTokens: 50, logicalParentUuid: 'm1' }
    const p = write(
      't.jsonl',
      buildTranscript({
        before: [msg('m0', 'user', 'a'), msg('m1', 'assistant', 'b')],
        boundary: spec,
        summary: 's',
        after: [msg('m2', 'user', 'c')],
        extraBoundary: spec,
      }),
    )
    expect(await findCompactBoundaries(p)).toHaveLength(1)
  })

  it('keeps two genuinely different compactions', async () => {
    const p = write(
      't.jsonl',
      buildTranscript({
        before: [msg('m0', 'user', 'a'), msg('m1', 'assistant', 'b')],
        boundary: { preservedUuids: ['m1'], preTokens: 500, postTokens: 50, logicalParentUuid: 'm1' },
        summary: 's1',
        after: [msg('m2', 'user', 'c')],
        extraBoundary: { preservedUuids: ['m2'], preTokens: 900, postTokens: 80, logicalParentUuid: 'm2' },
      }),
    )
    expect(await findCompactBoundaries(p)).toHaveLength(2)
  })

  it('handles a manual trigger', async () => {
    const p = write(
      't.jsonl',
      buildTranscript({ before: [msg('m0', 'user', 'a')], boundary: { trigger: 'manual', preservedUuids: [] }, summary: 's' }),
    )
    expect((await findCompactBoundaries(p))[0]!.trigger).toBe('manual')
  })

  it('tolerates a boundary with no summary following it', async () => {
    const p = write('t.jsonl', buildTranscript({ before: [msg('m0', 'user', 'a')], boundary: { preservedUuids: [] } }))
    const [b] = await findCompactBoundaries(p)
    expect(b!.summaryText).toBeUndefined()
  })
})

describe('helpers', () => {
  it('keys boundaries by content, not position', () => {
    const base = { lineIndex: 5, trigger: 'auto', preservedUuids: ['a'], preTokens: 1, postTokens: 2, logicalParentUuid: 'x' }
    expect(boundaryKey(base)).toBe(boundaryKey({ ...base, lineIndex: 900 }))
    expect(boundaryKey(base)).not.toBe(boundaryKey({ ...base, postTokens: 3 }))
  })

  it('extracts text from both string and block-array content', () => {
    expect(extractText('plain')).toBe('plain')
    expect(extractText([{ type: 'text', text: 'a' }, { type: 'thinking' }, { type: 'text', text: 'b' }])).toBe('a\nb')
    expect(extractText(undefined)).toBe('')
  })

  it('excludes sidechains and meta entries from conversational content', () => {
    expect(isConversational({ type: 'user', lineIndex: 0 })).toBe(true)
    expect(isConversational({ type: 'user', isSidechain: true, lineIndex: 0 })).toBe(false)
    expect(isConversational({ type: 'user', isMeta: true, lineIndex: 0 })).toBe(false)
    expect(isConversational({ type: 'system', subtype: COMPACT_BOUNDARY_SUBTYPE, lineIndex: 0 })).toBe(false)
  })
})
