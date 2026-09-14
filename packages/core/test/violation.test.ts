import { describe, it, expect } from 'vitest'
import { compileConstraint, compileConstraints } from '../src/detect/predicate.js'
import { evaluate, evaluateAll, detectViolations, toolCallsIn } from '../src/detect/violation.js'
import { makeItem } from '../src/extract/types.js'
import type { TranscriptEntry } from '../src/capture/transcript.js'

const rule = (t: string) => makeItem('constraint', 'rule', t, t.toLowerCase())

describe('compiling constraints into predicates', () => {
  it.each([
    ['never edit src/prod.ts', 'forbidden_path'],
    ['dont touch config/secrets.yml', 'forbidden_path'],
    ['dont push dev-tools fix', 'forbidden_path'],
    ['dont add comments in code', 'forbidden_content'],
    ['dont use random emoji like 💸', 'forbidden_content'],
    ['dont used data-test-id', 'forbidden_content'],
  ])('compiles %s', (text, kind) => {
    expect(compileConstraint(rule(text))?.kind).toBe(kind)
  })

  it.each([
    ['advice with no checkable object', 'you should destructure it'],
    ['a process request', 'you need to confirm with me first'],
    ['a vague reference', 'dont just do because we have the ticket of 4979'],
    ['too short a target', 'dont push it'],
  ])('refuses to compile %s', (_label, text) => {
    // Refusing is the correct outcome. A predicate we cannot state precisely is
    // a predicate we cannot defend when it accuses someone.
    expect(compileConstraint(rule(text))).toBeNull()
  })

  it('publishes coverage rather than hiding what it could not check', () => {
    const r = compileConstraints([rule('never edit src/prod.ts'), rule('you should destructure it')])
    expect(r.predicates).toHaveLength(1)
    expect(r.uncompilable).toHaveLength(1)
    expect(r.coverage).toBe(0.5)
  })

  it('produces a human-readable explanation for every predicate', () => {
    const p = compileConstraint(rule('never edit src/prod.ts'))!
    expect(p.explanation).toContain('src/prod.ts')
    expect(p.source.value).toBe('never edit src/prod.ts')
  })

  it('excludes command predicates by default', () => {
    // Verified against real transcripts: keyword matching inside shell commands
    // produced false positives (a branch name containing "recruit"), and three
    // wrong accusations is three too many.
    const off = compileConstraints([rule('dont run the full test suite')])
    expect(off.predicates).toHaveLength(0)
    expect(off.uncompilable).toHaveLength(1)

    const on = compileConstraints([rule('dont run the full test suite')], { includeCommandPredicates: true })
    expect(on.predicates).toHaveLength(1)
  })

  it('requires every token to match when command predicates are enabled', () => {
    const p = compileConstraint(rule('dont run full recruit test'))!
    expect(p.needles.length).toBeGreaterThanOrEqual(2)
    // The real false positive: a path mentioning recruit, but no test run.
    expect(evaluate(p, { name: 'Bash', input: { command: 'cd modules/recruit && git fetch' } })).toBeNull()
    expect(evaluate(p, { name: 'Bash', input: { command: 'npm run test --workspace recruit' } })).not.toBeNull()
  })
})

describe('evaluating a tool call', () => {
  it('flags an edit to a forbidden path', () => {
    const p = compileConstraint(rule('never edit src/prod.ts'))!
    const v = evaluate(p, { name: 'Edit', input: { file_path: '/repo/src/prod.ts' } })
    expect(v).not.toBeNull()
    expect(v!.field).toBe('file_path')
  })

  it('leaves a different path alone', () => {
    const p = compileConstraint(rule('never edit src/prod.ts'))!
    expect(evaluate(p, { name: 'Edit', input: { file_path: '/repo/src/other.ts' } })).toBeNull()
  })

  it('ignores tools the predicate does not apply to', () => {
    const p = compileConstraint(rule('never edit src/prod.ts'))!
    expect(evaluate(p, { name: 'Read', input: { file_path: '/repo/src/prod.ts' } })).toBeNull()
  })

  it('flags forbidden content in a write', () => {
    const p = compileConstraint(rule('dont add comments in code'))!
    expect(evaluate(p, { name: 'Write', input: { content: 'const a = 1\n// explain\n' } })).not.toBeNull()
    expect(evaluate(p, { name: 'Write', input: { content: 'const a = 1\n' } })).toBeNull()
  })

  it('flags an emoji when one was forbidden', () => {
    const p = compileConstraint(rule('dont use random emoji'))!
    expect(evaluate(p, { name: 'Edit', input: { new_string: 'done 🎉' } })).not.toBeNull()
    expect(evaluate(p, { name: 'Edit', input: { new_string: 'done' } })).toBeNull()
  })

  it('checks a call against every predicate', () => {
    const ps = compileConstraints([rule('never edit src/prod.ts'), rule('dont add comments in code')]).predicates
    const vs = evaluateAll(ps, { name: 'Edit', input: { file_path: '/repo/src/prod.ts', new_string: '// note' } })
    expect(vs).toHaveLength(2)
  })

  it('is a pure function — same inputs, same verdict', () => {
    const p = compileConstraint(rule('never edit src/prod.ts'))!
    const call = { name: 'Edit', input: { file_path: '/repo/src/prod.ts' } }
    expect(evaluate(p, call)).toEqual(evaluate(p, call))
  })
})

describe('detectViolations', () => {
  const toolEntry = (name: string, input: Record<string, unknown>, uuid: string): TranscriptEntry =>
    ({ type: 'assistant', uuid, lineIndex: 0, message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } })

  it('reports the denominator alongside the count', () => {
    const ps = compileConstraints([rule('never edit src/prod.ts')]).predicates
    const calls = toolCallsIn([
      toolEntry('Edit', { file_path: '/repo/src/prod.ts' }, 'a'),
      toolEntry('Read', { file_path: '/repo/src/other.ts' }, 'b'),
    ])
    const s = detectViolations(ps, calls)
    expect(s.violations).toHaveLength(1)
    expect(s.callsChecked).toBe(2)
    expect(s.predicatesChecked).toBe(1)
  })

  it('finds nothing when there are no predicates', () => {
    const s = detectViolations([], toolCallsIn([toolEntry('Edit', { file_path: '/x' }, 'a')]))
    expect(s.violations).toHaveLength(0)
  })

  it('extracts tool calls from transcript entries', () => {
    const calls = toolCallsIn([toolEntry('Bash', { command: 'ls' }, 'a')])
    expect(calls).toEqual([{ name: 'Bash', input: { command: 'ls' }, id: 'a' }])
  })
})
