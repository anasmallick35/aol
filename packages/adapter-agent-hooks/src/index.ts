import {
  PROTOCOL_VERSION,
  decide,
  type Interception,
  type InterceptionPoint as AolPoint,
  type Verdict as AolVerdict,
} from '@aol/core'
import {
  transformPermitted,
  type AgentContext,
  type Interceptor,
  type InterceptionPoint,
  type Verdict,
} from './contract.js'

export * from './contract.js'

/** AGENT-HOOKS point → our normalised point. */
const POINT_MAP: Record<InterceptionPoint, AolPoint> = {
  agent_startup: 'agent_start',
  input: 'input',
  pre_model_call: 'pre_model',
  post_model_call: 'post_model',
  pre_tool_call: 'pre_tool',
  post_tool_call: 'post_tool',
  output: 'output',
  agent_shutdown: 'agent_end',
}

interface ToolTarget {
  call_id?: string
  name?: string
  args?: unknown
  value?: unknown
  is_error?: boolean
}

function toolCallFrom(ctx: AgentContext): Interception['toolCall'] {
  if (ctx.interception_point !== 'pre_tool_call' && ctx.interception_point !== 'post_tool_call') return undefined
  const t = ctx.target as ToolTarget | undefined
  if (!t?.name) return undefined
  return {
    name: t.name,
    ...(t.call_id ? { id: t.call_id } : {}),
    ...(t.args !== undefined ? { input: t.args } : {}),
    ...(t.value !== undefined ? { output: t.value } : {}),
  }
}

/** Translate an AgentContext into our normalised interception. */
export function toInterception(ctx: AgentContext): Interception {
  const toolCall = toolCallFrom(ctx)
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: ctx.session.id,
    adapter: 'agent-hooks',
    framework: ctx.agent.framework,
    point: POINT_MAP[ctx.interception_point],
    ts: Date.parse(ctx.timestamp) || Date.now(),
    ...(toolCall ? { toolCall } : {}),
    meta: {
      interceptionPoint: ctx.interception_point,
      sequence: ctx.sequence,
      agentId: ctx.agent.id,
      ...(ctx.agent.name ? { agentName: ctx.agent.name } : {}),
    },
  }
}

/**
 * Translate our five-valued verdict into the spec's three.
 *
 * `warn` becomes an allow carrying a warning; `escalate` becomes a deny
 * carrying an approval block, which is exactly how the spec defines them
 * (§5.1). Nothing is lost, but the collapse has to be deliberate rather than
 * incidental.
 */
export function toVerdict(v: AolVerdict, point: InterceptionPoint): Verdict {
  switch (v.decision) {
    case 'allow':
      return { decision: 'allow' }

    case 'warn':
      return {
        decision: 'allow',
        warnings: [{ ...(v.reason ? { reason: v.reason } : {}), ...(v.message ? { message: v.message } : {}) }],
      }

    case 'deny':
      return { decision: 'deny', reason: v.reason ?? null, message: v.message ?? null }

    case 'escalate':
      // A liftable deny: denied as-is unless the approval seam lifts it.
      return { decision: 'deny', reason: v.reason ?? null, message: v.message ?? null, approval: {} }

    case 'transform': {
      // Transform is forbidden at the lifecycle endpoints. Degrading to a
      // warning keeps the finding visible rather than silently dropping it —
      // and emitting an invalid verdict would fail the host closed.
      if (!transformPermitted(point) || !v.transform) {
        return {
          decision: 'allow',
          warnings: [{ reason: v.reason ?? 'transform_not_permitted', message: v.message ?? 'repair unavailable at this point' }],
        }
      }
      return {
        decision: 'transform',
        reason: v.reason ?? null,
        message: v.message ?? null,
        transform: { path: '/extensions/aol_restore', value: v.transform.restore },
      }
    }
  }
}

export interface AolInterceptorOptions {
  socketPath?: string
  timeoutMs?: number
}

/**
 * The context-integrity interceptor.
 *
 * AGENT-HOOKS covers tool calls and model calls; it has no notion of a context
 * mutation, which is precisely the gap this product fills. So we watch the
 * points it does define and ask the daemon whether the agent still knows what
 * it needed to know.
 */
export class AolInterceptor implements Interceptor {
  constructor(private readonly opts: AolInterceptorOptions = {}) {}

  async intercept(context: AgentContext): Promise<Verdict> {
    // Never throw. A host treats an interceptor exception as a fail-closed
    // deny, so an unhandled error of ours would block a user's agent.
    try {
      const verdict = await decide(toInterception(context), this.opts)
      return toVerdict(verdict, context.interception_point)
    } catch {
      return { decision: 'allow', warnings: [{ reason: 'aol_unavailable', message: 'AOL interceptor error; action not evaluated' }] }
    }
  }
}

export function createInterceptor(opts: AolInterceptorOptions = {}): Interceptor {
  return new AolInterceptor(opts)
}
