import type { Predicate } from './predicate.js'
import type { ToolCall } from '../events.js'
import type { TranscriptEntry } from '../capture/transcript.js'
import { normalizeFilePath, normalizeCommand } from '../extract/artifacts.js'

/**
 * D5: an action taken AFTER a mutation that breaks a rule stated BEFORE it.
 *
 * This is what turns "a constraint went missing" into "and here is the damage".
 * Everything here is mechanical and reproducible — given the same predicate and
 * the same tool call, the verdict is always identical, and a user can check our
 * working by reading the predicate.
 */

export interface Violation {
  predicate: Predicate
  toolName: string
  /** The field that matched, for explaining the verdict. */
  field: string
  /** What actually matched, redacted before storage elsewhere. */
  matched: string
  sourceRef?: string
}

function fieldValue(input: unknown, field: string): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const v = (input as Record<string, unknown>)[field]
  return typeof v === 'string' ? v : undefined
}

/** Does this tool call break this rule? Pure function, no state, no model. */
export function evaluate(predicate: Predicate, call: ToolCall): Violation | null {
  if (predicate.tools.length && !predicate.tools.includes(call.name)) return null

  for (const field of predicate.fields) {
    const raw = fieldValue(call.input, field)
    if (!raw) continue

    let hit = false
    if (predicate.kind === 'forbidden_path') {
      const candidate = field === 'command' ? normalizeCommand(raw) : normalizeFilePath(raw)
      hit = predicate.needles.every((n) => candidate.includes(n))
    } else if (predicate.kind === 'forbidden_command') {
      // EVERY token must be present. Requiring only one produced 15 false
      // positives on real data.
      const candidate = normalizeCommand(raw)
      hit = predicate.needles.every((n) => candidate.includes(n))
    } else {
      // forbidden_content: needle is a regex source compiled from a known matcher.
      hit = new RegExp(predicate.needle, 'mu').test(raw)
    }

    if (hit) {
      return { predicate, toolName: call.name, field, matched: raw.slice(0, 200), ...(call.id ? { sourceRef: call.id } : {}) }
    }
  }
  return null
}

/** Evaluate one call against every predicate. */
export function evaluateAll(predicates: Predicate[], call: ToolCall): Violation[] {
  return predicates.map((p) => evaluate(p, call)).filter((v): v is Violation => v !== null)
}

interface ToolUseBlock {
  type?: string
  name?: string
  id?: string
  input?: Record<string, unknown>
}

/** Pull tool calls out of transcript entries, for offline analysis. */
export function toolCallsIn(entries: TranscriptEntry[]): ToolCall[] {
  const out: ToolCall[] = []
  for (const entry of entries) {
    const content = entry.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue
      const b = block as ToolUseBlock
      if (b.type !== 'tool_use' || !b.name) continue
      out.push({ name: b.name, input: b.input, ...(entry.uuid ? { id: entry.uuid } : {}) })
    }
  }
  return out
}

export interface ViolationSummary {
  violations: Violation[]
  /** Tool calls examined. The denominator. */
  callsChecked: number
  /** Predicates that could be checked. */
  predicatesChecked: number
}

export function detectViolations(predicates: Predicate[], calls: ToolCall[]): ViolationSummary {
  const violations: Violation[] = []
  for (const call of calls) violations.push(...evaluateAll(predicates, call))
  return { violations, callsChecked: calls.length, predicatesChecked: predicates.length }
}
