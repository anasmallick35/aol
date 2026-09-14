import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AolServer, openDb, type DB, type Interception } from '@aol/core'
import { AolInterceptor, toInterception, toVerdict, transformPermitted, SPEC_VERSION, type AgentContext } from '../src/index.js'

const ctx = (point: AgentContext['interception_point'] = 'pre_tool_call', over: Partial<AgentContext> = {}): AgentContext => ({
  spec: SPEC_VERSION,
  interception_point: point,
  timestamp: '2026-09-14T12:00:00Z',
  sequence: 1,
  agent: { id: 'a1', framework: 'langgraph' },
  session: { id: 's1' },
  target: { call_id: 'c1', name: 'Edit', args: { file_path: '/repo/prod.ts' } },
  ...over,
})

describe('context translation', () => {
  it('maps every interception point the spec defines', () => {
    const expected: Record<string, string> = {
      agent_startup: 'agent_start',
      input: 'input',
      pre_model_call: 'pre_model',
      post_model_call: 'post_model',
      pre_tool_call: 'pre_tool',
      post_tool_call: 'post_tool',
      output: 'output',
      agent_shutdown: 'agent_end',
    }
    for (const [hook, ours] of Object.entries(expected)) {
      expect(toInterception(ctx(hook as AgentContext['interception_point'])).point).toBe(ours)
    }
  })

  it('records the framework so reports can attribute findings', () => {
    expect(toInterception(ctx()).framework).toBe('langgraph')
    expect(toInterception(ctx()).adapter).toBe('agent-hooks')
  })

  it('extracts the tool call at tool points only', () => {
    expect(toInterception(ctx('pre_tool_call')).toolCall?.name).toBe('Edit')
    expect(toInterception(ctx('input')).toolCall).toBeUndefined()
  })

  it('falls back to now on an unparseable timestamp', () => {
    expect(toInterception(ctx('input', { timestamp: 'not a date' })).ts).toBeGreaterThan(0)
  })
})

describe('verdict collapse — five decisions into the spec’s three', () => {
  const base = { protocolVersion: 1 as const, detections: [] }

  it('allow stays allow', () => {
    expect(toVerdict({ ...base, decision: 'allow' }, 'pre_tool_call')).toEqual({ decision: 'allow' })
  })

  it('warn becomes an allow carrying a warning', () => {
    const v = toVerdict({ ...base, decision: 'warn', reason: 'r', message: 'm' }, 'pre_tool_call')
    expect(v.decision).toBe('allow')
    expect(v.warnings).toEqual([{ reason: 'r', message: 'm' }])
  })

  it('escalate becomes a liftable deny', () => {
    const v = toVerdict({ ...base, decision: 'escalate', reason: 'r' }, 'pre_tool_call')
    expect(v.decision).toBe('deny')
    expect(v.approval).toEqual({})
  })

  it('transform carries the repair payload', () => {
    const v = toVerdict({ ...base, decision: 'transform', transform: { restore: ['never edit prod'] } }, 'pre_tool_call')
    expect(v.decision).toBe('transform')
    expect(v.transform?.value).toEqual(['never edit prod'])
  })

  it.each(['agent_startup', 'agent_shutdown'] as const)('degrades transform to a warning at %s', (point) => {
    // Transform is forbidden at the lifecycle endpoints. Emitting it anyway
    // would be an invalid verdict and fail the host closed; dropping it
    // silently would hide a real finding.
    expect(transformPermitted(point)).toBe(false)
    const v = toVerdict({ ...base, decision: 'transform', transform: { restore: ['x'] } }, point)
    expect(v.decision).toBe('allow')
    expect(v.warnings?.[0]?.reason).toBe('transform_not_permitted')
  })
})

describe('AolInterceptor against a real daemon', () => {
  let dir: string
  let sock: string
  let db: DB
  let server: AolServer
  let seen: Interception[]

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'aol-ah-'))
    sock = join(dir, 'a.sock')
    db = openDb(join(dir, 'test.db'))
    seen = []
    server = new AolServer({
      socketPath: sock,
      db,
      decide: (e) => {
        seen.push(e)
        return e.toolCall?.name === 'Edit'
          ? { protocolVersion: 1, decision: 'deny', reason: 'constraint_violation', message: 'never edit prod', detections: [] }
          : { protocolVersion: 1, decision: 'allow', detections: [] }
      },
    })
    await server.listen()
  })

  afterEach(async () => {
    await server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('carries a deny back to the host', async () => {
    const v = await new AolInterceptor({ socketPath: sock }).intercept(ctx())
    expect(v.decision).toBe('deny')
    expect(v.reason).toBe('constraint_violation')
    expect(seen[0]!.adapter).toBe('agent-hooks')
  })

  it('allows when the action is fine', async () => {
    const v = await new AolInterceptor({ socketPath: sock }).intercept(
      ctx('pre_tool_call', { target: { call_id: 'c2', name: 'Read', args: {} } }),
    )
    expect(v.decision).toBe('allow')
  })

  it('never throws when the daemon is unreachable', async () => {
    // A host treats an interceptor exception as a fail-closed deny, so an
    // unhandled error of ours would block the user's agent.
    const v = await new AolInterceptor({ socketPath: join(dir, 'nope.sock'), timeoutMs: 300 }).intercept(ctx())
    expect(v.decision).toBe('deny')
    expect(v.reason).toBe('unreachable')
  })
})
