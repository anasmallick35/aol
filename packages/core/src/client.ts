import net from 'node:net'
import { FrameDecoder, encodeFrame } from './protocol.js'
import { parseVerdict, failClosed, type Verdict } from './verdict.js'
import type { Interception } from './events.js'
import { socketPath } from './paths.js'

export interface DecideOptions {
  socketPath?: string
  /**
   * Client-side deadline. Exceeding it yields a fail-closed deny, per
   * AGENT-HOOKS-0.1: a host that times an interceptor out must synthesise a
   * deny. Default is generous relative to our 50ms decision budget because the
   * cost of a spurious deny is higher than the cost of waiting.
   */
  timeoutMs?: number
}

/**
 * Send one interception and await a verdict.
 *
 * This never throws. Adapters run inside somebody's agent, and an exception
 * escaping here would take down their run. Every failure path resolves to an
 * explicit fail-closed deny instead, so the caller always gets a decision it
 * can act on.
 */
export function decide(event: Interception, opts: DecideOptions = {}): Promise<Verdict> {
  const path = opts.socketPath ?? socketPath()
  const timeoutMs = opts.timeoutMs ?? 2000

  return new Promise<Verdict>((resolve) => {
    let settled = false
    const finish = (v: Verdict) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(v)
    }

    const timer = setTimeout(() => finish(failClosed('timeout')), timeoutMs)
    const decoder = new FrameDecoder()
    const socket = net.createConnection(path)

    socket.on('connect', () => {
      try {
        socket.write(encodeFrame(event))
      } catch (err) {
        finish(failClosed(`write_failed:${String(err)}`))
      }
    })

    socket.on('data', (chunk: Buffer) => {
      decoder.push(chunk)
      try {
        for (const frame of decoder.drain()) {
          finish(parseVerdict(frame))
          return
        }
      } catch {
        finish(failClosed('malformed_verdict'))
      }
    })

    socket.on('error', () => finish(failClosed('unreachable')))
    socket.on('close', () => finish(failClosed('closed_before_verdict')))
  })
}
