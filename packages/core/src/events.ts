import { z } from 'zod'

/**
 * The normalised interception event.
 *
 * This model is deliberately adapter-agnostic: it must NOT import or mirror
 * AGENT-HOOKS types. That spec is 0.1 and the Agent Governance Toolkit is in
 * Public Preview; coupling the core to it is faster today and fatal if it
 * churns. Adapters translate into this shape, never the reverse.
 * See docs/07-stack-and-architecture-decisions.md §A2.
 */

export const PROTOCOL_VERSION = 1 as const

/**
 * Interception points.
 *
 * The first eight mirror the shape AGENT-HOOKS-0.1 settled on, so adapters map
 * one-to-one without losing information. The last two are ours: AGENT-HOOKS has
 * no concept of a context mutation, which is precisely the gap this product
 * exists to fill.
 */
export const interceptionPoints = [
  'agent_start',
  'input',
  'pre_model',
  'post_model',
  'pre_tool',
  'post_tool',
  'output',
  'agent_end',
  // ---- ours ----
  'pre_mutation',
  'post_mutation',
] as const

export const InterceptionPoint = z.enum(interceptionPoints)
export type InterceptionPoint = z.infer<typeof InterceptionPoint>

/** Points at which a deny verdict actually prevents something happening. */
export const ENFORCING_POINTS: ReadonlySet<InterceptionPoint> = new Set<InterceptionPoint>([
  'pre_tool',
  'pre_model',
  'input',
  'output',
])

/** How the agent's context was mutated. Compaction is the first we handle. */
export const MutationType = z.enum(['compaction', 'eviction', 'truncation', 'cache_hit'])
export type MutationType = z.infer<typeof MutationType>

export const ToolCall = z.object({
  id: z.string().optional(),
  name: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
})
export type ToolCall = z.infer<typeof ToolCall>

export const Mutation = z.object({
  type: MutationType,
  /** 'auto' | 'manual' where the host reports it. */
  trigger: z.string().optional(),
  preTokens: z.number().int().nonnegative().optional(),
  postTokens: z.number().int().nonnegative().optional(),
  /**
   * Opaque marker for where the cut fell, so pre/post windows can be sliced.
   * Format is adapter-defined (a message uuid, an index, a timestamp).
   */
  cutRef: z.string().optional(),
})
export type Mutation = z.infer<typeof Mutation>

/**
 * Where uncompacted ground truth lives, when the host keeps one.
 *
 * This matters more than it looks: Claude Code's transcript is append-only, so
 * compaction shrinks the model's context but not the file. Where a transcript
 * exists we diff against reality instead of reconstructing it.
 */
export const TranscriptRef = z.object({
  path: z.string(),
  format: z.enum(['claude-code-jsonl']),
})
export type TranscriptRef = z.infer<typeof TranscriptRef>

export const Interception = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionId: z.string().min(1),
  /** Which adapter produced this: 'claude-code', 'agent-hooks', 'synthetic'. */
  adapter: z.string().min(1),
  /** Host framework where known: 'langgraph', 'crewai', 'claude-code'. */
  framework: z.string().optional(),
  point: InterceptionPoint,
  /** Unix ms. Supplied by the adapter so replay stays faithful. */
  ts: z.number().int().nonnegative(),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
  toolCall: ToolCall.optional(),
  mutation: Mutation.optional(),
  transcript: TranscriptRef.optional(),
  /** Adapter-specific extras. Never load-bearing for a decision. */
  meta: z.record(z.unknown()).optional(),
})
export type Interception = z.infer<typeof Interception>

/** Parse untrusted adapter input. Throws ZodError on malformed payloads. */
export function parseInterception(raw: unknown): Interception {
  return Interception.parse(raw)
}

export function isMutationPoint(point: InterceptionPoint): boolean {
  return point === 'pre_mutation' || point === 'post_mutation'
}

export function isEnforcingPoint(point: InterceptionPoint): boolean {
  return ENFORCING_POINTS.has(point)
}
