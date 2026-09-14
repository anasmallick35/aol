import type { DB } from './db.js'
import type { Interception } from '../events.js'
import type { Verdict } from '../verdict.js'
import { redactForStorage } from '../redact.js'

export class Repo {
  constructor(private readonly db: DB) {}

  /** Upsert on every interception so session metadata stays current. */
  touchSession(e: Interception): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, adapter, framework, cwd, git_branch, first_seen, last_seen)
         VALUES (@id, @adapter, @framework, @cwd, @gitBranch, @ts, @ts)
         ON CONFLICT(id) DO UPDATE SET
           last_seen  = excluded.last_seen,
           framework  = COALESCE(excluded.framework, sessions.framework),
           cwd        = COALESCE(excluded.cwd, sessions.cwd),
           git_branch = COALESCE(excluded.git_branch, sessions.git_branch)`,
      )
      .run({
        id: e.sessionId,
        adapter: e.adapter,
        framework: e.framework ?? null,
        cwd: e.cwd ?? null,
        gitBranch: e.gitBranch ?? null,
        ts: e.ts,
      })
  }

  recordInterception(e: Interception, v: Verdict, elapsedMs: number): void {
    this.db
      .prepare(
        `INSERT INTO interceptions (session_id, point, adapter, tool_name, decision, elapsed_ms, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.sessionId, e.point, e.adapter, e.toolCall?.name ?? null, v.decision, elapsedMs, e.ts)
  }

  /** Returns the new event id. Mutation events anchor everything downstream. */
  recordMutationEvent(e: Interception): number {
    const m = e.mutation
    const info = this.db
      .prepare(
        `INSERT INTO events (session_id, kind, mutation_type, trigger, cut_ref, cut_ts,
                             pre_tokens, post_tokens, created_at)
         VALUES (?, 'mutation', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.sessionId,
        m?.type ?? null,
        m?.trigger ?? null,
        m?.cutRef ?? null,
        e.ts,
        m?.preTokens ?? null,
        m?.postTokens ?? null,
        Date.now(),
      )
    return Number(info.lastInsertRowid)
  }

  /**
   * Record a violation.
   *
   * Tool input is redacted on the way in, never on the way out. Doing it here
   * rather than at the call site means a later milestone cannot forget: there
   * is no path that writes raw input to this table.
   */
  recordViolation(args: {
    eventId?: number
    constraintItemId?: number
    sessionId: string
    interceptionPoint: string
    toolName?: string
    toolInput?: unknown
    verdict: string
    ts: number
  }): number {
    const info = this.db
      .prepare(
        `INSERT INTO violations (event_id, constraint_item_id, session_id, interception_point,
                                 tool_name, tool_input, verdict, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        args.eventId ?? null,
        args.constraintItemId ?? null,
        args.sessionId,
        args.interceptionPoint,
        args.toolName ?? null,
        redactForStorage(args.toolInput),
        args.verdict,
        args.ts,
      )
    return Number(info.lastInsertRowid)
  }

  countInterceptions(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM interceptions WHERE session_id = ?')
      .get(sessionId) as { n: number }
    return row.n
  }

  listMutationEvents(sessionId: string): Array<{ id: number; mutation_type: string | null; cut_ts: number | null }> {
    return this.db
      .prepare(
        `SELECT id, mutation_type, cut_ts FROM events
         WHERE session_id = ? AND kind = 'mutation' ORDER BY id`,
      )
      .all(sessionId) as Array<{ id: number; mutation_type: string | null; cut_ts: number | null }>
  }
}
