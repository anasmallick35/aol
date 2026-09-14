import { describe, it, expect } from 'vitest'
import { judgeSurvival, detectSurvival, contentTokens, UNCERTAIN_THRESHOLD } from '../src/detect/survival.js'
import { detectRedundancy } from '../src/detect/redundancy.js'
import { detect } from '../src/detect/index.js'
import { renderReport } from '../src/report/render.js'
import { makeItem } from '../src/extract/types.js'
import type { TranscriptEntry } from '../src/capture/transcript.js'
import type { MutationWindows } from '../src/capture/window.js'

const item = (value: string, norm = value.toLowerCase()) => makeItem('constraint', 'rule', value, norm)

const tool = (name: string, input: Record<string, unknown>, uuid = 'a'): TranscriptEntry =>
  ({ type: 'assistant', uuid, lineIndex: 0, message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } })

describe('survival judgement', () => {
  it('calls a verbatim match survived', () => {
    const v = judgeSurvival(item('never edit prod'), 'summary: user said never edit prod and asked for tests')
    expect(v.survival).toBe('survived')
    expect(v.overlap).toBe(1)
  })

  it('calls an absent item lost', () => {
    const v = judgeSurvival(item('you should destructure it'), 'summary: we refactored the parser and fixed a bug')
    expect(v.survival).toBe('lost')
    expect(v.overlap).toBeLessThan(UNCERTAIN_THRESHOLD)
  })

  it('calls a paraphrase uncertain rather than guessing', () => {
    // A summary paraphrases. "dont put comment in code" may survive perfectly
    // as "the user asked for no code comments" — semantically intact, lexically
    // absent. Claiming either "survived" or "lost" there would be a lie.
    const v = judgeSurvival(item('dont put comment in code'), 'the user asked that comment blocks not appear in the code')
    expect(v.survival).toBe('uncertain')
  })

  it('refuses to judge an item with no distinctive words', () => {
    expect(judgeSurvival(item('do not do it'), 'anything').survival).toBe('uncertain')
  })

  it('ignores stopwords when measuring overlap', () => {
    expect(contentTokens('the user should always use the parser')).toEqual(['user', 'always', 'parser'])
  })

  it('summarises without folding uncertain into either bucket', () => {
    const s = detectSurvival(
      [item('never edit prod'), item('you should destructure it'), item('dont put comment in code')],
      'never edit prod. the user asked that comment blocks not appear in the code',
    )
    expect(s.total).toBe(3)
    expect(s.survived).toBe(1)
    expect(s.uncertain).toBe(1)
    expect(s.lost).toBe(1)
    expect(s.lostRate).toBeCloseTo(1 / 3)
  })
})

describe('redundancy detection', () => {
  it('flags a file read again after the cut', () => {
    const r = detectRedundancy([tool('Read', { file_path: '/repo/a.ts' })], [tool('Read', { file_path: '/repo/a.ts' })])
    expect(r.redundant).toHaveLength(1)
    expect(r.rate).toBe(1)
  })

  it('does not flag a re-read after the file was written', () => {
    // Re-reading a file you just changed is correct behaviour. Counting it
    // would be a bug, not a detection.
    const r = detectRedundancy(
      [tool('Read', { file_path: '/repo/a.ts' })],
      [tool('Edit', { file_path: '/repo/a.ts' }), tool('Read', { file_path: '/repo/a.ts' })],
    )
    expect(r.redundant).toHaveLength(0)
  })

  it('counts each target once however often it is re-read', () => {
    const r = detectRedundancy(
      [tool('Read', { file_path: '/repo/a.ts' })],
      [tool('Read', { file_path: '/repo/a.ts' }), tool('Read', { file_path: './a.ts' })],
    )
    expect(r.redundant).toHaveLength(1)
  })

  it('ignores targets that were never read before the cut', () => {
    const r = detectRedundancy([tool('Read', { file_path: '/repo/a.ts' })], [tool('Read', { file_path: '/repo/b.ts' })])
    expect(r.redundant).toHaveLength(0)
  })
})

describe('detect + render', () => {
  const windows = (over: Partial<MutationWindows> = {}): MutationWindows => ({
    dropped: [],
    preserved: [],
    summaryText: '',
    control: [],
    groundTruthAvailable: true,
    ...over,
  })

  const user = (text: string, uuid: string): TranscriptEntry =>
    ({ type: 'user', uuid, lineIndex: 0, message: { role: 'user', content: text } })

  it('produces a control alongside every measurement', () => {
    const r = detect(
      windows({
        dropped: [user('never edit prod', 'd1')],
        summaryText: 'we worked on the parser',
        control: [user('always run tests', 'c1'), user('and then we shipped it', 'c2')],
      }),
    )
    expect(r.constraints.total).toBe(1)
    expect(r.control).toBeDefined()
    expect(r.control.constraints).toBeDefined()
  })

  it('refuses to compare when the sample is too small', () => {
    // Two items lost out of three is not a signal, however dramatic the
    // percentage looks.
    const r = detect(windows({ dropped: [user('never edit prod', 'd1')], summaryText: 'unrelated' }))
    const out = renderReport(r)
    expect(out).toMatch(/sample too small|no comparable items/)
  })

  it('says plainly when ground truth is unavailable', () => {
    const out = renderReport(detect(windows({ groundTruthAvailable: false })))
    expect(out).toContain('Ground truth unavailable')
    expect(out).toContain('NOT the same as "nothing was lost"')
  })

  it('shows the legend and never hides the uncertain bucket', () => {
    const out = renderReport(detect(windows({ dropped: [user('never edit prod', 'd1')], summaryText: 'x' })))
    expect(out).toContain('uncertain')
    expect(out).toContain('survived')
    expect(out).toContain('lost')
  })

  it('lists the individual lost constraints when verbose', () => {
    const r = detect(windows({ dropped: [user('you should destructure it', 'd1')], summaryText: 'unrelated summary' }))
    const out = renderReport(r, { verbose: true })
    expect(out).toContain('you should destructure it')
  })
})
