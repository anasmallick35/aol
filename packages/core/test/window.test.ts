import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findCompactBoundaries } from '../src/capture/transcript.js'
import { sliceWindows, windowText, survivingText } from '../src/capture/window.js'
import { buildTranscript, msg } from './fixtures/transcript.js'

let dir: string
const write = (content: string) => {
  const p = join(dir, 't.jsonl')
  writeFileSync(p, content)
  return p
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aol-win-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function slice(content: string, opts?: { controlSize?: number }) {
  const p = write(content)
  const [b] = await findCompactBoundaries(p)
  return sliceWindows(p, b!, opts ?? {})
}

describe('sliceWindows', () => {
  it('splits messages before the cut into dropped and preserved', async () => {
    const w = await slice(
      buildTranscript({
        before: [
          msg('m0', 'user', 'never edit prod.ts'),
          msg('m1', 'assistant', 'noted'),
          msg('m2', 'user', 'now refactor the parser'),
          msg('m3', 'assistant', 'on it'),
        ],
        boundary: { preservedUuids: ['m2', 'm3'], logicalParentUuid: 'm3' },
        summary: 'Refactoring the parser.',
      }),
    )
    expect(w.preserved.map((e) => e.uuid)).toEqual(['m2', 'm3'])
    expect(w.dropped.map((e) => e.uuid)).toEqual(['m0', 'm1'])
    expect(w.groundTruthAvailable).toBe(true)
  })

  it('carries the summary as what replaced the dropped content', async () => {
    const w = await slice(
      buildTranscript({
        before: [msg('m0', 'user', 'always run tests'), msg('m1', 'assistant', 'ok')],
        boundary: { preservedUuids: ['m1'], logicalParentUuid: 'm1' },
        summary: 'User asked for tests.',
      }),
    )
    expect(w.summaryText).toContain('User asked for tests.')
    expect(survivingText(w)).toContain('User asked for tests.')
    expect(survivingText(w)).toContain('ok')
  })

  it('excludes sidechain messages from the windows', async () => {
    // Subagent traffic is not the main agent's context, so counting it would
    // inflate the dropped set with content the agent never held.
    const w = await slice(
      buildTranscript({
        before: [msg('m0', 'user', 'a'), msg('m1', 'assistant', 'sub', { sidechain: true }), msg('m2', 'user', 'b')],
        boundary: { preservedUuids: ['m2'], logicalParentUuid: 'm2' },
        summary: 's',
      }),
    )
    expect([...w.dropped, ...w.preserved].map((e) => e.uuid)).not.toContain('m1')
  })

  it('builds a matched control window of the messages before the cut', async () => {
    const before = Array.from({ length: 100 }, (_, i) => msg(`m${i}`, i % 2 ? 'assistant' : 'user', `turn ${i}`))
    const w = await slice(
      buildTranscript({ before, boundary: { preservedUuids: ['m99'], logicalParentUuid: 'm99' }, summary: 's' }),
      { controlSize: 10 },
    )
    expect(w.control).toHaveLength(10)
    expect(w.control.at(-1)!.uuid).toBe('m99')
    expect(w.control[0]!.uuid).toBe('m90')
  })

  it('reports groundTruthAvailable=false for a resumed session', async () => {
    // Observed in real data: a resumed session's transcript opens with a
    // boundary whose messages live in the PARENT session's file. Reporting
    // "0 dropped" there would be indistinguishable from a clean compaction and
    // would mean the opposite thing.
    const w = await slice(
      buildTranscript({ before: [], boundary: { preservedUuids: ['gone-1', 'gone-2'], logicalParentUuid: 'gone-2' }, summary: 'carried over' }),
    )
    expect(w.groundTruthAvailable).toBe(false)
    expect(w.dropped).toHaveLength(0)
    expect(w.preserved).toHaveLength(0)
  })

  it('does not treat a genuinely empty preserved list as missing ground truth', async () => {
    const w = await slice(
      buildTranscript({ before: [msg('m0', 'user', 'a')], boundary: { preservedUuids: [], logicalParentUuid: 'm0' }, summary: 's' }),
    )
    expect(w.groundTruthAvailable).toBe(true)
    expect(w.dropped).toHaveLength(1)
  })

  it('stops at the boundary and ignores messages after it', async () => {
    const w = await slice(
      buildTranscript({
        before: [msg('m0', 'user', 'before')],
        boundary: { preservedUuids: [], logicalParentUuid: 'm0' },
        summary: 's',
        after: [msg('m9', 'user', 'after the cut')],
      }),
    )
    expect(windowText(w.dropped)).toContain('before')
    expect(windowText(w.dropped)).not.toContain('after the cut')
  })
})

describe('windowText', () => {
  it('joins entry text and handles both content shapes', async () => {
    const w = await slice(
      buildTranscript({
        before: [msg('m0', 'user', 'plain string'), msg('m1', 'assistant', 'block array')],
        boundary: { preservedUuids: [], logicalParentUuid: 'm1' },
        summary: 's',
      }),
    )
    const text = windowText(w.dropped)
    expect(text).toContain('plain string')
    expect(text).toContain('block array')
  })
})
