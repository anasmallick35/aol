import { z } from 'zod'
import { PROTOCOL_VERSION } from './events.js'

/**
 * Verdicts.
 *
 * `allow` / `warn` / `deny` / `escalate` follow the Agent Control Specification
 * so adapters can pass them through without inventing a mapping. `transform` is
 * how repair happens: we hand back a modified context rather than blocking, and
 * the agent carries on. See docs/06-implementation-plan.md §4.5.
 */
export const Decision = z.enum(['allow', 'warn', 'deny', 'transform', 'escalate'])
export type Decision = z.infer<typeof Decision>

/** A single thing a detector noticed. Advisory at this point; M4 fills these in. */
export const Detection = z.object({
  detector: z.string(),
  severity: z.enum(['info', 'warn', 'critical']),
  detail: z.string(),
  itemKind: z.enum(['constraint', 'artifact', 'commitment']).optional(),
  value: z.string().optional(),
})
export type Detection = z.infer<typeof Detection>

/**
 * Repair payload for a `transform` verdict.
 *
 * `restore` holds items the mutation dropped that we want re-injected. Note
 * this is not free: modifying a compacted prefix invalidates exact-prefix
 * cache matching and forfeits the cached-input discount downstream, so
 * `estimatedTokens` exists to make that trade visible rather than hidden.
 */
export const Transform = z.object({
  restore: z.array(z.string()).default([]),
  instructions: z.string().optional(),
  estimatedTokens: z.number().int().nonnegative().optional(),
})
export type Transform = z.infer<typeof Transform>

export const Verdict = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  decision: Decision,
  /** Machine-readable cause, e.g. 'constraint_violation', 'interceptor_error'. */
  reason: z.string().optional(),
  /** Human-readable text the host may surface to the user. */
  message: z.string().optional(),
  transform: Transform.optional(),
  detections: z.array(Detection).default([]),
  elapsedMs: z.number().nonnegative().optional(),
})
export type Verdict = z.infer<typeof Verdict>

export function allow(detections: Detection[] = []): Verdict {
  return { protocolVersion: PROTOCOL_VERSION, decision: 'allow', detections }
}

export function warn(message: string, detections: Detection[] = []): Verdict {
  return { protocolVersion: PROTOCOL_VERSION, decision: 'warn', message, detections }
}

export function deny(reason: string, message?: string, detections: Detection[] = []): Verdict {
  return { protocolVersion: PROTOCOL_VERSION, decision: 'deny', reason, message, detections }
}

export function escalate(reason: string, message?: string, detections: Detection[] = []): Verdict {
  return { protocolVersion: PROTOCOL_VERSION, decision: 'escalate', reason, message, detections }
}

export function transform(t: Transform, message?: string, detections: Detection[] = []): Verdict {
  return {
    protocolVersion: PROTOCOL_VERSION,
    decision: 'transform',
    // Spread first: an object built by hand may omit `restore`, and zod's
    // default only applies on parse, not on construction.
    transform: { ...t, restore: t.restore ?? [] },
    message,
    detections,
  }
}

/**
 * The verdict a client synthesises when the daemon cannot be reached, times
 * out, or answers with something malformed.
 *
 * AGENT-HOOKS-0.1 requires exactly this: a host that cannot get a valid verdict
 * must synthesise a deny. A gate that fails open is not a gate.
 */
export function failClosed(reason: string): Verdict {
  return {
    protocolVersion: PROTOCOL_VERSION,
    decision: 'deny',
    reason,
    message: `ContextKeep could not complete a decision (${reason}); denying per fail-closed policy.`,
    detections: [],
  }
}

export function parseVerdict(raw: unknown): Verdict {
  return Verdict.parse(raw)
}
