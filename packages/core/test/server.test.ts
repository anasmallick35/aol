import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { ContextKeepServer } from '../src/server.js'
import { decide } from '../src/client.js'
import { openDb, type DB } from '../src/store/db.js'
import { PROTOCOL_VERSION, type Interception } from '../src/events.js'
import { allow, deny, transform } from '../src/verdict.js'
import { encodeFrame } from '../src/protocol.js'

let dir: string
let sock: string
let db: DB
let server: ContextKeepServer | undefined

const event = (over: Partial<Interception> = {}): Interception => ({
  protocolVersion: PROTOCOL_VERSION,
  sessionId: 's1',
  adapter: 'synthetic',
  point: 'pre_tool',
  ts: Date.now(),
  toolCall: { name: 'Edit', input: { file_path: '/repo/src/index.ts' } },
  ...over,
})

async function start(opts: Partial<ConstructorParameters<typeof ContextKeepServer>[0]> = {}) {
  server = new ContextKeepServer({ socketPath: sock, db, ...opts })
  await server.listen()
  return server
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'contextkeep-srv-'))
  sock = join(dir, 'contextkeep.sock')
  db = openDb(join(dir, 'test.db'))
})

afterEach(async () => {
  await server?.close()
  server = undefined
  rmSync(dir, { recursive: true, force: true })
})

describe('daemon', () => {
  it('drives a synthetic interception end-to-end', async () => {
    await start()
    const v = await decide(event(), { socketPath: sock })
    expect(v.decision).toBe('allow')
    expect(v.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(v.elapsedMs).toBeTypeOf('number')
  })

  it('returns and honours a deny verdict', async () => {
    await start({ decide: () => deny('constraint_violation', 'never edit /repo/prod.ts') })
    const v = await decide(event(), { socketPath: sock })
    expect(v.decision).toBe('deny')
    expect(v.reason).toBe('constraint_violation')
    expect(v.message).toContain('never edit')
  })

  it('returns a transform verdict carrying repair content', async () => {
    await start({
      decide: () => transform({ restore: ['always run tests before committing'], estimatedTokens: 12 }),
    })
    const v = await decide(event({ point: 'post_mutation', mutation: { type: 'compaction' } }), { socketPath: sock })
    expect(v.decision).toBe('transform')
    expect(v.transform?.restore).toEqual(['always run tests before committing'])
    expect(v.transform?.estimatedTokens).toBe(12)
  })

  it('persists every interception', async () => {
    await start()
    await decide(event(), { socketPath: sock })
    await decide(event({ point: 'post_tool' }), { socketPath: sock })
    const n = db.prepare('SELECT COUNT(*) AS n FROM interceptions').get() as { n: number }
    expect(n.n).toBe(2)
  })

  it('records a mutation event on post_mutation', async () => {
    await start()
    await decide(
      event({ point: 'post_mutation', mutation: { type: 'compaction', trigger: 'auto', cutRef: 'uuid-123' } }),
      { socketPath: sock },
    )
    const rows = db.prepare("SELECT * FROM events WHERE kind='mutation'").all() as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]!.mutation_type).toBe('compaction')
    expect(rows[0]!.cut_ref).toBe('uuid-123')
  })

  it('denies a malformed interception rather than crashing', async () => {
    // Malformed input is always a deny regardless of failure mode: we were
    // handed something we cannot reason about, so we have no basis to permit it.
    await start()
    const v = await new Promise<{ decision: string; reason?: string }>((resolve) => {
      const s = net.createConnection(sock, () => s.write(encodeFrame({ nonsense: true })))
      s.on('data', (buf: Buffer) => {
        resolve(JSON.parse(buf.subarray(4).toString('utf8')))
        s.destroy()
      })
    })
    expect(v.decision).toBe('deny')
    expect(v.reason).toBe('malformed_interception')
  })

  it("allows when our own detector throws and failureMode is 'observe'", async () => {
    // A bug in our detectors must not halt somebody's agent while we are only
    // observing. This is deliberately NOT the protocol-level fail-closed rule.
    await start({
      failureMode: 'observe',
      decide: () => {
        throw new Error('detector bug')
      },
    })
    const v = await decide(event(), { socketPath: sock })
    expect(v.decision).toBe('allow')
  })

  it("denies when our own detector throws and failureMode is 'enforce'", async () => {
    await start({
      failureMode: 'enforce',
      decide: () => {
        throw new Error('detector bug')
      },
    })
    const v = await decide(event(), { socketPath: sock })
    expect(v.decision).toBe('deny')
    expect(v.reason).toBe('interceptor_error')
  })

  it("allows a non-enforcing point even in 'enforce' mode when a detector throws", async () => {
    // Denying at post_tool prevents nothing that has not already happened; it
    // would only break the run.
    await start({
      failureMode: 'enforce',
      decide: () => {
        throw new Error('detector bug')
      },
    })
    const v = await decide(event({ point: 'post_tool' }), { socketPath: sock })
    expect(v.decision).toBe('allow')
  })

  it('handles several interceptions on one connection', async () => {
    await start()
    const results = await Promise.all([
      decide(event(), { socketPath: sock }),
      decide(event({ point: 'pre_model' }), { socketPath: sock }),
      decide(event({ point: 'output' }), { socketPath: sock }),
    ])
    expect(results.map((r) => r.decision)).toEqual(['allow', 'allow', 'allow'])
  })

  it('replaces a stale socket file left by a crashed daemon', async () => {
    // A daemon that is SIGKILLed leaves its socket file on disk; without the
    // unlink in listen(), the next start fails with EADDRINUSE.
    const orphan = net.createServer()
    await new Promise<void>((r) => orphan.listen(sock, r))
    await new Promise<void>((r) => orphan.close(() => r()))
    writeFileSync(sock, '')
    expect(existsSync(sock)).toBe(true)

    const second = await start()
    expect(second.address).toBe(sock)
    const v = await decide(event(), { socketPath: sock })
    expect(v.decision).toBe('allow')
  })
})

describe('client fail-closed behaviour', () => {
  it('denies when the daemon is unreachable', async () => {
    // AGENT-HOOKS-0.1: a host that cannot reach an interceptor must synthesise
    // a deny. A gate that fails open is not a gate.
    const v = await decide(event(), { socketPath: join(dir, 'nonexistent.sock'), timeoutMs: 500 })
    expect(v.decision).toBe('deny')
    expect(v.reason).toBe('unreachable')
  })

  it('denies on timeout rather than throwing', async () => {
    await start({ decide: () => new Promise(() => {}) as Promise<never> })
    const v = await decide(event(), { socketPath: sock, timeoutMs: 150 })
    expect(v.decision).toBe('deny')
    expect(v.reason).toBe('timeout')
  })

  it('denies when the daemon answers with a malformed verdict', async () => {
    const open: net.Socket[] = []
    const bad = net.createServer((s) => {
      open.push(s)
      s.write(encodeFrame({ not: 'a verdict' }))
    })
    const badPath = join(dir, 'bad.sock')
    await new Promise<void>((r) => bad.listen(badPath, r))

    const v = await decide(event(), { socketPath: badPath, timeoutMs: 500 })
    expect(v.decision).toBe('deny')
    expect(v.reason).toBe('malformed_verdict')

    for (const s of open) s.destroy()
    await new Promise<void>((r) => bad.close(() => r()))
  })
})

describe('decision budget', () => {
  it('stays under the 50ms budget across 100 interceptions', async () => {
    await start({ decide: () => allow() })
    const timings: number[] = []
    for (let i = 0; i < 100; i++) {
      const v = await decide(event({ sessionId: `s${i % 5}` }), { socketPath: sock })
      timings.push(v.elapsedMs ?? Infinity)
    }
    const sorted = [...timings].sort((a, b) => a - b)
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!
    // Server-side decision time only; transport is measured separately below.
    expect(p95).toBeLessThan(50)
  })

  it('completes a full round-trip well inside the client timeout', async () => {
    await start()
    const started = performance.now()
    for (let i = 0; i < 50; i++) await decide(event(), { socketPath: sock })
    const perCall = (performance.now() - started) / 50
    expect(perCall).toBeLessThan(50)
  })
})
