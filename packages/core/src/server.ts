import net from 'node:net'
import { existsSync, unlinkSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { FrameDecoder, encodeFrame } from './protocol.js'
import { parseInterception, isEnforcingPoint, type Interception } from './events.js'
import { allow, deny, failClosed, type Verdict } from './verdict.js'
import { openDb, type DB } from './store/db.js'
import { Repo } from './store/repo.js'
import { ensureHome, socketPath } from './paths.js'
import { logger } from './log.js'

/**
 * What to do when OUR OWN decision logic throws.
 *
 * This is a different question from the protocol-level fail-closed rule, and
 * conflating the two would be a mistake. AGENT-HOOKS-0.1 requires the *host* to
 * synthesise a deny when it cannot reach an interceptor or gets a malformed
 * verdict — that is handled client-side in `decide()` and is not configurable.
 *
 * Here we are reachable and answering; the question is what a bug in our
 * detectors should cost the user. Denying would mean any defect of ours halts
 * somebody's agent mid-run, which during P1 — when we observe and do not
 * enforce — is a far worse failure than missing a detection. So the default is
 * 'observe', loudly logged. Flip to 'enforce' when enforcement ships in M7.
 */
export type FailureMode = 'observe' | 'enforce'

export interface ServerOptions {
  socketPath?: string
  db?: DB
  failureMode?: FailureMode
  /** Injected by later milestones. M1 ships the transport, not the detectors. */
  decide?: (e: Interception, ctx: { repo: Repo }) => Verdict | Promise<Verdict>
}

export class AolServer {
  readonly #server: net.Server
  readonly #path: string
  readonly #db: DB
  readonly #repo: Repo
  readonly #failureMode: FailureMode
  readonly #decide: NonNullable<ServerOptions['decide']>

  constructor(opts: ServerOptions = {}) {
    ensureHome()
    this.#path = opts.socketPath ?? socketPath()
    this.#db = opts.db ?? openDb()
    this.#repo = new Repo(this.#db)
    this.#failureMode = opts.failureMode ?? 'observe'
    this.#decide = opts.decide ?? (() => allow())
    this.#server = net.createServer((socket) => this.#onConnection(socket))
  }

  #onConnection(socket: net.Socket): void {
    const decoder = new FrameDecoder()
    socket.on('error', (err) => logger.warn('socket error', { err: String(err) }))
    socket.on('data', (chunk: Buffer) => {
      decoder.push(chunk)
      let frames: unknown[]
      try {
        frames = [...decoder.drain()]
      } catch (err) {
        // Unparseable stream: we cannot recover framing, so close rather than
        // guess. The client will synthesise a fail-closed deny.
        logger.error('framing error, closing connection', { err: String(err) })
        socket.destroy()
        return
      }
      for (const frame of frames) void this.#handle(socket, frame)
    })
  }

  async #handle(socket: net.Socket, frame: unknown): Promise<void> {
    const started = performance.now()
    let event: Interception | undefined
    let verdict: Verdict

    try {
      event = parseInterception(frame)
      this.#repo.touchSession(event)
      if (event.point === 'post_mutation' && event.mutation) {
        this.#repo.recordMutationEvent(event)
      }
      verdict = await this.#decide(event, { repo: this.#repo })
    } catch (err) {
      const reason = event ? 'interceptor_error' : 'malformed_interception'
      logger.error('decision failed', { reason, err: String(err), point: event?.point })
      // Malformed input is always a deny: we were handed something we cannot
      // reason about, so we have no basis to permit it.
      verdict =
        !event || (this.#failureMode === 'enforce' && isEnforcingPoint(event.point))
          ? deny(reason, 'AOL could not evaluate this interception.')
          : allow()
    }

    const elapsedMs = performance.now() - started
    verdict = { ...verdict, elapsedMs }

    if (event) {
      try {
        this.#repo.recordInterception(event, verdict, elapsedMs)
      } catch (err) {
        logger.error('failed to record interception', { err: String(err) })
      }
    }

    if (!socket.destroyed) socket.write(encodeFrame(verdict))
  }

  listen(): Promise<string> {
    return new Promise((resolve, reject) => {
      // A stale socket from a crashed daemon would block bind with EADDRINUSE.
      if (existsSync(this.#path)) {
        try {
          unlinkSync(this.#path)
        } catch {
          /* bind will surface the real problem */
        }
      }
      this.#server.once('error', reject)
      this.#server.listen(this.#path, () => {
        this.#server.removeListener('error', reject)
        logger.info('aol daemon listening', { path: this.#path, failureMode: this.#failureMode })
        resolve(this.#path)
      })
    })
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.#server.close(() => resolve()))
    try {
      this.#db.close()
    } catch {
      /* already closed */
    }
    if (existsSync(this.#path)) {
      try {
        unlinkSync(this.#path)
      } catch {
        /* best effort */
      }
    }
  }

  get address(): string {
    return this.#path
  }
}

export { failClosed }
