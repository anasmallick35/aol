import { readFileSync } from 'node:fs'
import {
  PROTOCOL_VERSION,
  decide,
  findCompactBoundaries,
  sliceWindows,
  logger,
  type Interception,
  type InterceptionPoint,
} from '@aol/core'

/**
 * Claude Code hook dispatch.
 *
 * Registered once in settings and invoked for every hook event; we route on
 * `hook_event_name` rather than installing eight separate commands.
 *
 * THE RULE THAT OVERRIDES EVERYTHING HERE: a hook runs inside somebody's
 * session. Whatever goes wrong, we exit 0 and let their work continue. The one
 * exception is a deliberate block at an enforcing point, which exits 2 — and
 * that arrives in M7.
 */

interface HookInput {
  hook_event_name?: string
  session_id?: string
  transcript_path?: string
  cwd?: string
  /** PreCompact / PostCompact: 'auto' | 'manual'. */
  trigger?: string
  /** SessionStart: 'startup' | 'resume' | 'clear' | 'compact' | 'fork'. */
  source?: string
  tool_name?: string
  tool_input?: unknown
  tool_use_id?: string
}

const POINT_BY_EVENT: Record<string, InterceptionPoint> = {
  PreCompact: 'pre_mutation',
  PostCompact: 'post_mutation',
  PreToolUse: 'pre_tool',
  PostToolUse: 'post_tool',
  SessionStart: 'agent_start',
  SessionEnd: 'agent_end',
  UserPromptSubmit: 'input',
  Stop: 'output',
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Build the interception for a PostCompact event.
 *
 * The authoritative read happens here rather than at PreCompact because the
 * transcript is flushed asynchronously and lags the live conversation — at
 * PreCompact the final turns may not be on disk yet. PreCompact records only
 * that a compaction started.
 */
async function enrichPostCompact(input: HookInput, base: Interception): Promise<Interception> {
  const path = input.transcript_path
  if (!path) return base

  let boundaries
  try {
    boundaries = await findCompactBoundaries(path)
  } catch (err) {
    // A missing or unreadable transcript must not lose the event. We still know
    // a compaction happened — we just cannot see what it cost, which is exactly
    // what `transcriptUnreadable` says.
    logger.warn('could not read transcript for PostCompact', { path, err: String(err) })
    return {
      ...base,
      mutation: { type: 'compaction', ...(input.trigger ? { trigger: input.trigger } : {}) },
      meta: { ...base.meta, transcriptUnreadable: true },
    }
  }

  const latest = boundaries.at(-1)
  if (!latest) {
    // Claude Code writes the boundary asynchronously too, so a PostCompact hook
    // can legitimately fire before the record lands. Say so rather than
    // pretending we captured a mutation.
    logger.warn('PostCompact fired but no compact_boundary found yet', { path })
    return { ...base, meta: { ...base.meta, boundaryPending: true } }
  }

  let windows
  try {
    windows = await sliceWindows(path, latest)
  } catch (err) {
    // The boundary metadata is still worth keeping even if the second pass fails.
    logger.warn('could not slice windows for PostCompact', { path, err: String(err) })
    return {
      ...base,
      mutation: {
        type: 'compaction',
        trigger: latest.trigger,
        ...(latest.preTokens !== undefined ? { preTokens: latest.preTokens } : {}),
        ...(latest.postTokens !== undefined ? { postTokens: latest.postTokens } : {}),
      },
      meta: { ...base.meta, windowsUnavailable: true },
    }
  }

  return {
    ...base,
    mutation: {
      type: 'compaction',
      trigger: latest.trigger,
      ...(latest.preTokens !== undefined ? { preTokens: latest.preTokens } : {}),
      ...(latest.postTokens !== undefined ? { postTokens: latest.postTokens } : {}),
      ...(latest.logicalParentUuid ? { cutRef: latest.logicalParentUuid } : {}),
    },
    transcript: { path, format: 'claude-code-jsonl' },
    meta: {
      ...base.meta,
      droppedMessages: windows.dropped.length,
      preservedMessages: windows.preserved.length,
      controlSize: windows.control.length,
      groundTruthAvailable: windows.groundTruthAvailable,
      summaryChars: latest.summaryText?.length ?? 0,
      cumulativeDroppedTokens: latest.cumulativeDroppedTokens,
      durationMs: latest.durationMs,
    },
  }
}

export async function runHook(rawInput: string): Promise<number> {
  let input: HookInput
  try {
    input = JSON.parse(rawInput) as HookInput
  } catch (err) {
    logger.warn('hook received unparseable input', { err: String(err) })
    return 0
  }

  const event = input.hook_event_name ?? ''
  const point = POINT_BY_EVENT[event]
  if (!point) {
    logger.debug('ignoring unmapped hook event', { event })
    return 0
  }

  let interception: Interception = {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: input.session_id ?? 'unknown',
    adapter: 'claude-code',
    framework: 'claude-code',
    point,
    ts: Date.now(),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.tool_name
      ? { toolCall: { name: input.tool_name, input: input.tool_input, ...(input.tool_use_id ? { id: input.tool_use_id } : {}) } }
      : {}),
    ...(input.transcript_path ? { transcript: { path: input.transcript_path, format: 'claude-code-jsonl' as const } } : {}),
    meta: {
      hookEvent: event,
      ...(input.trigger ? { trigger: input.trigger } : {}),
      ...(input.source ? { source: input.source } : {}),
    },
  }

  if (point === 'pre_mutation') {
    interception = {
      ...interception,
      mutation: { type: 'compaction', ...(input.trigger ? { trigger: input.trigger } : {}) },
    }
  } else if (point === 'post_mutation') {
    interception = await enrichPostCompact(input, interception)
  }

  const verdict = await decide(interception)

  // M2 observes only. Enforcement — translating a deny into exit 2 — is M7,
  // and shipping it before the detectors exist would block on nothing.
  if (verdict.decision === 'deny' && verdict.reason !== 'unreachable') {
    logger.info('verdict would block (not enforced until M7)', { reason: verdict.reason, point })
  }
  return 0
}

export async function hookCommand(): Promise<void> {
  let code = 0
  try {
    code = await runHook(await readStdin())
  } catch (err) {
    // Never let our failure become their failure.
    logger.error('hook dispatch failed', { err: String(err) })
    code = 0
  }
  process.exit(code)
}

export function readHookFile(path: string): string {
  return readFileSync(path, 'utf8')
}
