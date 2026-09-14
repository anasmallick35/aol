import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Gate, capabilitiesFor, UNKNOWN_CAPABILITIES, fitToBudget, estimateTokens, DEFAULT_REPAIR_BUDGET_TOKENS } from '../src/gate/index.js'
import { openDb, type DB } from '../src/store/db.js'
import { Repo } from '../src/store/repo.js'
import { PROTOCOL_VERSION, type Interception } from '../src/events.js'
import { buildTranscript, msg } from './fixtures/transcript.js'

let dir: string
let db: DB
let repo: Repo

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'contextkeep-gate-'))
  db = openDb(join(dir, 'test.db'))
  repo = new Repo(db)
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const transcript = (content: string) => {
  const p = join(dir, 's.jsonl')
  writeFileSync(p, content)
  return p
}

/** A compaction that drops a constraint the summary does not mention. */
const droppedConstraint = () =>
  transcript(
    buildTranscript({
      before: [
        msg('m0', 'user', 'never edit src/prod.ts'),
        msg('m1', 'assistant', 'understood'),
        msg('m2', 'user', 'now refactor the parser'),
      ],
      boundary: { preservedUuids: ['m2'], logicalParentUuid: 'm2', preTokens: 900_000, postTokens: 12_000 },
      summary: 'We were refactoring the parser.',
    }),
  )

const mutation = (path: string, adapter = 'claude-code'): Interception => ({
  protocolVersion: PROTOCOL_VERSION,
  sessionId: 's1',
  adapter,
  point: 'post_mutation',
  ts: Date.now(),
  transcript: { path, format: 'claude-code-jsonl' },
})

const toolCall = (name: string, input: unknown, adapter = 'claude-code'): Interception => ({
  protocolVersion: PROTOCOL_VERSION,
  sessionId: 's1',
  adapter,
  point: 'pre_tool',
  ts: Date.now(),
  toolCall: { name, input },
})

describe('capabilities', () => {
  it('does not claim Claude Code can repair', () => {
    // PreCompact/PostCompact cannot modify anything. Claiming otherwise would
    // tell someone their agent is protected when it is not.
    expect(capabilitiesFor('claude-code').repair).toBe(false)
    expect(capabilitiesFor('claude-code').block).toBe(true)
  })

  it('gives an unknown adapter the safe floor', () => {
    expect(capabilitiesFor('something-new')).toEqual(UNKNOWN_CAPABILITIES)
    expect(UNKNOWN_CAPABILITIES.block).toBe(false)
  })
})

describe('repair budget', () => {
  it('fits what it can and reports what it could not', () => {
    const b = fitToBudget(['a'.repeat(400), 'b'.repeat(400)], { maxTokens: 120 })
    expect(b.restore).toHaveLength(1)
    expect(b.dropped).toHaveLength(1)
    expect(b.overBudget).toBe(true)
  })

  it('reports no overrun when everything fits', () => {
    const b = fitToBudget(['short rule'], { maxTokens: DEFAULT_REPAIR_BUDGET_TOKENS })
    expect(b.overBudget).toBe(false)
    expect(b.estimatedTokens).toBeGreaterThan(0)
  })

  it('estimates tokens crudely but monotonically', () => {
    expect(estimateTokens('x'.repeat(400))).toBeGreaterThan(estimateTokens('x'.repeat(40)))
  })
})

describe('rung 3 — repair', () => {
  it('returns a transform carrying the dropped constraint where the adapter can repair', async () => {
    const gate = new Gate({ mode: 'warn' })
    const v = await gate.decide(mutation(droppedConstraint(), 'agent-hooks'), { repo })
    expect(v.decision).toBe('transform')
    expect(v.transform?.restore.some((r) => r.includes('never edit src/prod.ts'))).toBe(true)
    // The cache cost of re-injection must be stated, not hidden.
    expect(v.message).toMatch(/prompt cache/i)
  })

  it('warns instead of repairing where the adapter cannot repair', async () => {
    const gate = new Gate({ mode: 'warn' })
    const v = await gate.decide(mutation(droppedConstraint(), 'claude-code'), { repo })
    expect(v.decision).toBe('warn')
    expect(v.message).toMatch(/cannot repair inline/i)
    expect(v.detections.some((d) => d.detector === 'D1')).toBe(true)
  })

  it('escalates when nothing fits the repair budget', async () => {
    // Compaction fired because context was full, so the critical set may not
    // fit. Escalating beats silently proceeding.
    const gate = new Gate({ mode: 'warn', maxTokens: 1 })
    const v = await gate.decide(mutation(droppedConstraint(), 'agent-hooks'), { repo })
    expect(v.decision).toBe('escalate')
    expect(v.reason).toBe('repair_budget_exceeded')
  })

  it('stays silent in observe mode', async () => {
    const gate = new Gate({ mode: 'observe' })
    const v = await gate.decide(mutation(droppedConstraint(), 'agent-hooks'), { repo })
    expect(v.decision).toBe('warn')
    expect(v.transform).toBeUndefined()
  })

  it('says so rather than claiming nothing was lost when ground truth is missing', async () => {
    const p = transcript(
      buildTranscript({ before: [], boundary: { preservedUuids: ['gone'], logicalParentUuid: 'gone' }, summary: 'carried over' }),
    )
    const v = await new Gate().decide(mutation(p, 'agent-hooks'), { repo })
    expect(v.decision).toBe('warn')
    expect(v.reason).toBe('ground_truth_unavailable')
  })
})

describe('rung 4 — block the consequence', () => {
  it('denies a tool call that breaks a rule lost to compaction', async () => {
    const gate = new Gate({ mode: 'block' })
    await gate.decide(mutation(droppedConstraint()), { repo })
    const v = gate.stateFor('s1')
    expect(v!.predicates.length).toBeGreaterThan(0)

    const verdict = await gate.decide(toolCall('Edit', { file_path: '/repo/src/prod.ts' }), { repo })
    expect(verdict.decision).toBe('deny')
    // The message must name the rule and the check, so a user can argue with it.
    expect(verdict.message).toContain('never edit src/prod.ts')
    expect(verdict.message).toMatch(/no longer has in context/i)
  })

  it('warns instead of denying in warn mode', async () => {
    const gate = new Gate({ mode: 'warn' })
    await gate.decide(mutation(droppedConstraint()), { repo })
    const verdict = await gate.decide(toolCall('Edit', { file_path: '/repo/src/prod.ts' }), { repo })
    expect(verdict.decision).toBe('warn')
  })

  it('allows an unrelated tool call', async () => {
    const gate = new Gate({ mode: 'block' })
    await gate.decide(mutation(droppedConstraint()), { repo })
    const verdict = await gate.decide(toolCall('Edit', { file_path: '/repo/src/other.ts' }), { repo })
    expect(verdict.decision).toBe('allow')
  })

  it('allows everything before any mutation has been seen', async () => {
    const gate = new Gate({ mode: 'block' })
    const verdict = await gate.decide(toolCall('Edit', { file_path: '/repo/src/prod.ts' }), { repo })
    expect(verdict.decision).toBe('allow')
  })

  it('records the violation with tool input redacted', async () => {
    const gate = new Gate({ mode: 'block' })
    await gate.decide(mutation(droppedConstraint()), { repo })
    await gate.decide(
      toolCall('Edit', { file_path: '/repo/src/prod.ts', new_string: "token sk-live-abcdefghijklmnop" }),
      { repo },
    )
    const row = db.prepare('SELECT * FROM violations').get() as { tool_input: string; verdict: string }
    expect(row.verdict).toBe('deny')
    expect(row.tool_input).not.toContain('sk-live-abcdefghijklmnop')
  })

  it('never blocks the compaction itself', async () => {
    // We gate effects, not mechanisms — so the design survives any vendor
    // changing how they compact.
    const gate = new Gate({ mode: 'block' })
    const v = await gate.decide(mutation(droppedConstraint()), { repo })
    expect(v.decision).not.toBe('deny')
  })
})

describe('mode defaults', () => {
  it('defaults to warn, not observe and not block', () => {
    // Detectors have run against real data with zero false positives, so
    // surfacing findings is safe. Blocking is opt-in because a wrong block
    // costs a user real work.
    expect(new Gate().mode).toBe('warn')
  })
})
