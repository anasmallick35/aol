import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AolServer, openDb, type DB, type Interception } from '@aol/core'
import { runHook } from '../src/hooks.js'
import { buildTranscript, msg } from '../../core/test/fixtures/transcript.js'

let dir: string
let sock: string
let db: DB
let server: AolServer
let seen: Interception[]

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'aol-hook-'))
  sock = join(dir, 'h.sock')
  db = openDb(join(dir, 'test.db'))
  seen = []
  process.env.AOL_SOCKET = sock
  server = new AolServer({
    socketPath: sock,
    db,
    decide: (e) => {
      seen.push(e)
      return { protocolVersion: 1, decision: 'allow', detections: [] }
    },
  })
  await server.listen()
})

afterEach(async () => {
  await server.close()
  delete process.env.AOL_SOCKET
  rmSync(dir, { recursive: true, force: true })
})

const transcript = (content: string) => {
  const p = join(dir, 'session.jsonl')
  writeFileSync(p, content)
  return p
}

describe('hook dispatch', () => {
  it('maps PreToolUse to a pre_tool interception', async () => {
    const code = await runHook(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'abc',
        cwd: '/repo',
        tool_name: 'Edit',
        tool_input: { file_path: '/repo/a.ts' },
        tool_use_id: 'tu_1',
      }),
    )
    expect(code).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.point).toBe('pre_tool')
    expect(seen[0]!.adapter).toBe('claude-code')
    expect(seen[0]!.toolCall?.name).toBe('Edit')
    expect(seen[0]!.toolCall?.id).toBe('tu_1')
  })

  it('maps PreCompact to a pre_mutation interception carrying the trigger', async () => {
    await runHook(JSON.stringify({ hook_event_name: 'PreCompact', session_id: 'abc', trigger: 'auto' }))
    expect(seen[0]!.point).toBe('pre_mutation')
    expect(seen[0]!.mutation?.type).toBe('compaction')
    expect(seen[0]!.mutation?.trigger).toBe('auto')
  })

  it('enriches PostCompact from the transcript on disk', async () => {
    // The authoritative read happens at PostCompact, not PreCompact: the
    // transcript is flushed asynchronously and lags the live conversation.
    const p = transcript(
      buildTranscript({
        before: [
          msg('m0', 'user', 'never edit prod.ts'),
          msg('m1', 'assistant', 'understood'),
          msg('m2', 'user', 'refactor the parser'),
        ],
        boundary: { preservedUuids: ['m2'], preTokens: 900_000, postTokens: 12_000, logicalParentUuid: 'm2' },
        summary: 'Refactoring the parser.',
      }),
    )
    await runHook(JSON.stringify({ hook_event_name: 'PostCompact', session_id: 'abc', transcript_path: p, trigger: 'auto' }))

    const e = seen[0]!
    expect(e.point).toBe('post_mutation')
    expect(e.mutation?.preTokens).toBe(900_000)
    expect(e.mutation?.postTokens).toBe(12_000)
    expect(e.mutation?.cutRef).toBe('m2')
    expect(e.transcript?.format).toBe('claude-code-jsonl')
    expect(e.meta?.droppedMessages).toBe(2)
    expect(e.meta?.preservedMessages).toBe(1)
    expect(e.meta?.groundTruthAvailable).toBe(true)
    expect(e.meta?.summaryChars).toBeGreaterThan(0)
  })

  it('flags a PostCompact whose boundary has not been flushed yet', async () => {
    // Claude Code writes the boundary asynchronously too, so the hook can fire
    // before the record lands. Saying so beats pretending we captured a mutation.
    const p = transcript(buildTranscript({ before: [msg('m0', 'user', 'hi')] }))
    await runHook(JSON.stringify({ hook_event_name: 'PostCompact', session_id: 'abc', transcript_path: p }))
    expect(seen[0]!.point).toBe('post_mutation')
    expect(seen[0]!.meta?.boundaryPending).toBe(true)
    expect(seen[0]!.mutation).toBeUndefined()
  })

  it('records SessionStart source so a compaction-started session is identifiable', async () => {
    await runHook(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'abc', source: 'compact' }))
    expect(seen[0]!.point).toBe('agent_start')
    expect(seen[0]!.meta?.source).toBe('compact')
  })

  it('ignores hook events it does not map', async () => {
    const code = await runHook(JSON.stringify({ hook_event_name: 'Notification', session_id: 'abc' }))
    expect(code).toBe(0)
    expect(seen).toHaveLength(0)
  })
})

describe('hook resilience', () => {
  // A hook runs inside somebody's session. Whatever goes wrong, their work
  // continues: exit 0, always, until enforcement lands in M7.

  it('exits 0 on unparseable input', async () => {
    expect(await runHook('{ not json')).toBe(0)
    expect(seen).toHaveLength(0)
  })

  it('exits 0 on an empty payload', async () => {
    expect(await runHook('')).toBe(0)
  })

  it('still reports the mutation when the transcript is unreadable', async () => {
    // Losing the event because we could not open a file would be worse than
    // reporting it without detail: we know a compaction happened either way.
    const code = await runHook(
      JSON.stringify({
        hook_event_name: 'PostCompact',
        session_id: 'abc',
        trigger: 'auto',
        transcript_path: join(dir, 'missing.jsonl'),
      }),
    )
    expect(code).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.point).toBe('post_mutation')
    expect(seen[0]!.mutation?.type).toBe('compaction')
    expect(seen[0]!.meta?.transcriptUnreadable).toBe(true)
  })

  it('exits 0 when the daemon is not running', async () => {
    // The client synthesises a fail-closed deny here, but M2 observes only, so
    // an unreachable daemon must not block the user's session.
    await server.close()
    const code = await runHook(JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'abc', tool_name: 'Read' }))
    expect(code).toBe(0)
  })

  it('exits 0 when the payload has no session id', async () => {
    const code = await runHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read' }))
    expect(code).toBe(0)
    expect(seen[0]!.sessionId).toBe('unknown')
  })
})
