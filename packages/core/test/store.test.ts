import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, migrate, type DB } from '../src/store/db.js'
import { Repo } from '../src/store/repo.js'
import { PROTOCOL_VERSION, type Interception } from '../src/events.js'
import { allow } from '../src/verdict.js'

let dir: string
let db: DB

const event = (over: Partial<Interception> = {}): Interception => ({
  protocolVersion: PROTOCOL_VERSION,
  sessionId: 's1',
  adapter: 'synthetic',
  point: 'pre_tool',
  ts: 1_700_000_000_000,
  ...over,
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aol-store-'))
  db = openDb(join(dir, 'test.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('store', () => {
  it('applies migrations', () => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as { n: number }
    expect(n.n).toBeGreaterThan(0)
  })

  it('is idempotent on repeated migration', () => {
    migrate(db)
    migrate(db)
    const n = db.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as { n: number }
    expect(n.n).toBe(1)
  })

  it('upserts a session without duplicating it', () => {
    const repo = new Repo(db)
    repo.touchSession(event())
    repo.touchSession(event({ ts: 1_700_000_001_000, framework: 'langgraph' }))
    const rows = db.prepare('SELECT * FROM sessions').all() as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]!.framework).toBe('langgraph')
    expect(rows[0]!.last_seen).toBe(1_700_000_001_000)
  })

  it('keeps earlier metadata when a later interception omits it', () => {
    const repo = new Repo(db)
    repo.touchSession(event({ cwd: '/repo', gitBranch: 'main' }))
    repo.touchSession(event({ ts: 1_700_000_002_000 }))
    const row = db.prepare('SELECT * FROM sessions').get() as Record<string, unknown>
    expect(row.cwd).toBe('/repo')
    expect(row.git_branch).toBe('main')
  })

  it('records a mutation event and returns its id', () => {
    const repo = new Repo(db)
    repo.touchSession(event())
    const id = repo.recordMutationEvent(
      event({ point: 'post_mutation', mutation: { type: 'compaction', trigger: 'auto', preTokens: 167_000, postTokens: 40_000 } }),
    )
    expect(id).toBeGreaterThan(0)
    expect(repo.listMutationEvents('s1')).toHaveLength(1)
  })

  it('counts interceptions per session', () => {
    const repo = new Repo(db)
    repo.touchSession(event())
    repo.recordInterception(event(), allow(), 1.2)
    repo.recordInterception(event(), allow(), 0.9)
    expect(repo.countInterceptions('s1')).toBe(2)
    expect(repo.countInterceptions('nope')).toBe(0)
  })

  it('enforces the kind check constraint', () => {
    expect(() =>
      db.prepare("INSERT INTO events (session_id, kind, created_at) VALUES ('s1','bogus',1)").run(),
    ).toThrow()
  })
})

describe('violation recording', () => {
  it('redacts tool input on the way into the database', () => {
    // Guarding the storage path rather than the call site: there is no way to
    // write raw tool input to this table, so a later milestone cannot forget.
    const repo = new Repo(db)
    repo.touchSession(event())
    repo.recordViolation({
      sessionId: 's1',
      interceptionPoint: 'pre_tool',
      toolName: 'Bash',
      toolInput: { command: "curl -H 'Authorization: Bearer sk-live-9a8b7c6d5e4f' https://api.stripe.com" },
      verdict: 'deny',
      ts: 1_700_000_000_000,
    })
    const row = db.prepare('SELECT * FROM violations').get() as { tool_input: string; tool_name: string }
    expect(row.tool_input).not.toContain('sk-live-9a8b7c6d5e4f')
    expect(row.tool_input).toContain('api.stripe.com')
    expect(row.tool_name).toBe('Bash')
  })

  it('stores NULL when there is no tool input', () => {
    const repo = new Repo(db)
    repo.touchSession(event())
    repo.recordViolation({ sessionId: 's1', interceptionPoint: 'pre_model', verdict: 'warn', ts: 1 })
    const row = db.prepare('SELECT tool_input FROM violations').get() as { tool_input: string | null }
    expect(row.tool_input).toBeNull()
  })
})
