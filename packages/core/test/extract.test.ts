import { describe, it, expect } from 'vitest'
import {
  extractConstraints, splitClauses, classifyClause,
  extractArtifacts, normalizeFilePath, normalizeCommand,
  extractCommitments, isOpen,
  extractAll, normalizeText, dedupe, makeItem,
} from '../src/extract/index.js'
import type { TranscriptEntry } from '../src/capture/transcript.js'

const user = (text: string, uuid = 'u1'): TranscriptEntry =>
  ({ type: 'user', uuid, lineIndex: 0, message: { role: 'user', content: text } })

const assistantTool = (name: string, input: Record<string, unknown>, uuid = 'a1'): TranscriptEntry =>
  ({ type: 'assistant', uuid, lineIndex: 0, message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } })

describe('constraint extraction', () => {
  it.each([
    'never edit files in prod/',
    'always run the tests before committing',
    "don't add comments in code",
    'dont wait for my approval',
    'make sure the migration runs first',
    'you should destructure it',
    'you need to confirm with me first',
    'avoid using data-test-id',
    'use snake_case not camelCase',
  ])('extracts the real instruction: %s', (text) => {
    expect(extractConstraints([user(text)])).toHaveLength(1)
  })

  it.each([
    ['a question with a mark', 'should we remove that doc?'],
    ['a question opener', 'is this the right approach'],
    ['first person about the speaker', "i still dont understand what's happening"],
    ['first person plural', 'we will think about the cost later'],
    ['a descriptive statement about a system', 'The replication engine always runs a pull leg'],
    ['a descriptive statement with an article', 'An action without a data field can never be dispatched'],
    ['too short', 'no'],
  ])('rejects %s', (_label, text) => {
    // Tuned against 11,216 real clauses: a naive keyword match fired on 81 of
    // 444 turns and was mostly noise. These are the shapes it got wrong.
    expect(extractConstraints([user(text)])).toHaveLength(0)
  })

  it('ignores assistant turns', () => {
    // An agent restating a rule is not the user setting one. Counting its own
    // words would let it manufacture constraints it then preserves.
    const a: TranscriptEntry = { type: 'assistant', uuid: 'a1', lineIndex: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'never edit prod' }] } }
    expect(extractConstraints([a])).toHaveLength(0)
  })

  it('ignores the compaction summary itself', () => {
    const s: TranscriptEntry = { type: 'user', uuid: 's', lineIndex: 0, isCompactSummary: true, message: { content: 'never edit prod' } }
    expect(extractConstraints([s])).toHaveLength(0)
  })

  it('pulls several constraints out of one turn', () => {
    const items = extractConstraints([user("never edit prod. always run tests. don't add comments")])
    expect(items).toHaveLength(3)
  })

  it('strips URLs so they cannot shred clause splitting', () => {
    const items = extractConstraints([user('check https://github.com/a/b/pull/1. never edit prod')])
    expect(items).toHaveLength(1)
    expect(items[0]!.value).toContain('never edit prod')
  })

  it('records the source entry', () => {
    expect(extractConstraints([user('never edit prod', 'uuid-9')])[0]!.sourceRef).toBe('uuid-9')
  })

  it('splits clauses on sentence and list boundaries', () => {
    expect(splitClauses('a. b; c\nd, e')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('classifies directly', () => {
    expect(classifyClause('never edit prod')).toBe('high')
    expect(classifyClause('is this right')).toBeNull()
  })
})

describe('artifact extraction', () => {
  it('takes file paths from tool fields', () => {
    const items = extractArtifacts([assistantTool('Edit', { file_path: '/repo/src/index.ts' })])
    expect(items).toHaveLength(1)
    expect(items[0]!.subtype).toBe('file')
    expect(items[0]!.confidence).toBe('high')
  })

  it('takes commands from Bash calls', () => {
    const items = extractArtifacts([assistantTool('Bash', { command: 'npm run build' })])
    expect(items[0]!.subtype).toBe('command')
    expect(items[0]!.norm).toBe('npm run build')
  })

  it('ignores prose by default and includes it on request', () => {
    const e = user('I edited /repo/src/a.ts and hit TypeError: undefined is not a function')
    expect(extractArtifacts([e])).toHaveLength(0)
    const withProse = extractArtifacts([e], { includeProse: true })
    expect(withProse.length).toBeGreaterThanOrEqual(2)
    // Prose is lower confidence: a path in a sentence may be hypothetical.
    expect(withProse.every((i) => i.confidence === 'medium')).toBe(true)
  })

  it('makes equivalent paths compare equal', () => {
    expect(normalizeFilePath('./src/a.ts')).toBe(normalizeFilePath('src/a.ts'))
    expect(normalizeFilePath('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
    expect(normalizeFilePath('"/repo/a.ts"')).toBe('/repo/a.ts')
  })

  it('makes the same command compare equal across runs', () => {
    expect(normalizeCommand('npm   run   build')).toBe('npm run build')
    expect(normalizeCommand('node script.js 1739827482910')).toBe(normalizeCommand('node script.js 1739827482999'))
  })

  it('dedupes the same file touched repeatedly', () => {
    const items = extractAll([
      assistantTool('Read', { file_path: '/repo/a.ts' }, 'x1'),
      assistantTool('Edit', { file_path: '/repo/a.ts' }, 'x2'),
    ])
    expect(items.filter((i) => i.subtype === 'file')).toHaveLength(1)
  })
})

describe('commitment extraction', () => {
  it('extracts open todos and drops completed ones', () => {
    const items = extractCommitments([
      assistantTool('TodoWrite', {
        todos: [
          { content: 'wire up the parser', status: 'in_progress' },
          { content: 'write the README', status: 'completed' },
          { content: 'add tests', status: 'pending' },
        ],
      }),
    ])
    expect(items.map((i) => i.value).sort()).toEqual(['add tests', 'wire up the parser'])
  })

  it('lets a later call supersede an earlier one', () => {
    // TodoWrite rewrites the whole list, so a task completed later must not
    // still count as open from an earlier call.
    const items = extractCommitments([
      assistantTool('TodoWrite', { todos: [{ content: 'ship it', status: 'pending' }] }, 't1'),
      assistantTool('TodoWrite', { todos: [{ content: 'ship it', status: 'completed' }] }, 't2'),
    ])
    expect(items).toHaveLength(0)
  })

  it('treats an unknown status as open', () => {
    expect(isOpen({ status: 'blocked' })).toBe(true)
    expect(isOpen({})).toBe(true)
    expect(isOpen({ status: 'completed' })).toBe(false)
  })

  it('accepts TaskCreate shapes too', () => {
    const items = extractCommitments([assistantTool('TaskCreate', { task: { title: 'review the ADR', state: 'todo' } })])
    expect(items).toHaveLength(1)
  })
})

describe('normalisation and dedupe', () => {
  it('canonicalises text', () => {
    expect(normalizeText('  **Never   Edit Prod.**  ')).toBe('never   edit prod'.replace(/\s+/g, ' '))
  })

  it('dedupes by hash and keeps the higher confidence', () => {
    const a = makeItem('artifact', 'file', 'a.ts', 'a.ts', 'medium')
    const b = makeItem('artifact', 'file', 'a.ts', 'a.ts', 'high')
    const out = dedupe([a, b])
    expect(out).toHaveLength(1)
    expect(out[0]!.confidence).toBe('high')
  })
})
