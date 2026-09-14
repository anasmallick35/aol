/**
 * AGENT-HOOKS-0.1 contract, declared locally.
 *
 * We do NOT import `@responsibleai/agent-hooks` at runtime. Three reasons, all
 * of them load-bearing:
 *
 *  1. Our core must stay adapter-agnostic (docs/07 §A2). The spec is 0.1 and
 *     the npm package is 0.1.0-alpha.2 — coupling to its types is fatal if it
 *     churns.
 *  2. The SDK wraps a Rust core via napi-rs and, at alpha.2, ships only
 *     `agent-hooks.linux-x64-gnu.node`. There is no darwin-arm64 build, so
 *     importing it would make our adapter unloadable on a Mac.
 *  3. TypeScript is structurally typed. An object satisfying `Interceptor`
 *     works with their emitter whether or not we imported their interface.
 *
 * Shapes below are transcribed from the published `.d.ts` of alpha.2 and
 * carry section references so they can be re-checked against the spec.
 */

export const SPEC_VERSION = 'agent-hooks/0.1'

/** §3 — the closed set of interception points. Note: no mutation point exists. */
export type InterceptionPoint =
  | 'agent_startup'
  | 'input'
  | 'pre_model_call'
  | 'post_model_call'
  | 'pre_tool_call'
  | 'post_tool_call'
  | 'output'
  | 'agent_shutdown'

/**
 * §5.1 — THREE decisions, not five.
 *
 * Worth stating because it is a real difference from our internal model:
 * `warn` is an `allow` carrying warnings, and `escalate` is a `deny` carrying
 * an `approval` block. Our five-valued verdict collapses into this on the way
 * out, and nothing is lost — but the mapping has to be deliberate.
 */
export type Decision = 'allow' | 'deny' | 'transform'

export interface Warning {
  reason?: string
  message?: string
}

export interface Transform {
  path: string
  value: unknown
}

export interface Verdict {
  decision: Decision
  reason?: string | null
  message?: string | null
  warnings?: Warning[]
  /** §9 — present only on deny; marks it liftable by the approval seam. */
  approval?: Record<string, unknown>
  transform?: Transform
  evidence?: unknown
  result_labels?: string[]
}

/** §4 — the context handed to an interceptor. */
export interface AgentContext {
  spec: string
  interception_point: InterceptionPoint
  timestamp: string
  sequence: number
  agent: { id: string; framework: string; name?: string; version?: string }
  session: { id: string; started_at?: string; turn?: number }
  target: unknown
  extensions?: Record<string, unknown>
  [conditional: string]: unknown
}

export interface Interceptor {
  intercept(context: AgentContext): Verdict | Promise<Verdict>
}

/** §3, §4.3 — transform is not permitted at the lifecycle endpoints. */
export function transformPermitted(point: InterceptionPoint): boolean {
  return point !== 'agent_startup' && point !== 'agent_shutdown'
}

/** §11 — reserved host error reasons. */
export const HostError = {
  ContextInvalid: 'host_error:context_invalid',
  InterceptorFailed: 'host_error:interceptor_failed',
  InterceptorTimeout: 'host_error:interceptor_timeout',
  VerdictInvalid: 'host_error:verdict_invalid',
} as const
