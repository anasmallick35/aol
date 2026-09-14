import { PROTOCOL_VERSION, type Interception } from '../events.js'
import { allow, warn, deny, escalate, transform, type Verdict, type Detection } from '../verdict.js'
import { findCompactBoundaries } from '../capture/transcript.js'
import { sliceWindows, survivingText } from '../capture/window.js'
import { extractAll } from '../extract/index.js'
import { detectSurvival } from '../detect/survival.js'
import { compileConstraints, type Predicate } from '../detect/predicate.js'
import { evaluateAll } from '../detect/violation.js'
import { capabilitiesFor, type AdapterCapabilities } from './capabilities.js'
import { fitToBudget, type BudgetOptions } from './budget.js'
import { logger } from '../log.js'
import type { Repo } from '../store/repo.js'

export * from './capabilities.js'
export * from './budget.js'

/**
 * The gate.
 *
 * Implements the response ladder from docs/06 §4.5 — prevent, detect, repair,
 * block, report — taking the highest rung the adapter supports.
 *
 * Two things it deliberately does NOT do:
 *  - It never performs a compaction.
 *  - It never blocks a compaction. We gate EFFECTS, not mechanisms, so the
 *    design survives any vendor changing how they compact.
 */

export type GateMode = 'observe' | 'warn' | 'block'

export interface GateOptions extends BudgetOptions {
  /**
   * Default is `warn`, not `observe` and not `block`.
   *
   * `observe` was right while detectors were unproven. They have now run
   * against real transcripts with zero false positives once command predicates
   * were disabled, so surfacing findings is safe. Blocking is not the default
   * because a wrong block costs a user real work, and that trust is not worth
   * spending before anyone has asked us to enforce.
   */
  mode?: GateMode
}

interface SessionState {
  /** Rules in force, compiled from constraints present before the last mutation. */
  predicates: Predicate[]
  /** Dropped items worth restoring, highest priority first. */
  restorable: string[]
  /** Constraints we could not compile — reported, never enforced. */
  uncompilable: number
  lastMutationTs: number
}

export class Gate {
  readonly #mode: GateMode
  readonly #budget: BudgetOptions
  readonly #sessions = new Map<string, SessionState>()

  constructor(opts: GateOptions = {}) {
    this.#mode = opts.mode ?? 'warn'
    this.#budget = opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}
  }

  get mode(): GateMode {
    return this.#mode
  }

  /** Per-session rules currently in force. Exposed for the report and tests. */
  stateFor(sessionId: string): SessionState | undefined {
    return this.#sessions.get(sessionId)
  }

  async decide(event: Interception, ctx: { repo: Repo }): Promise<Verdict> {
    const caps = capabilitiesFor(event.adapter)
    if (event.point === 'post_mutation') return this.#onMutation(event, caps)
    if (event.point === 'pre_tool' || event.point === 'pre_model') return this.#onAction(event, caps, ctx)
    return allow()
  }

  /** Rung 2 (detect) and rung 3 (repair). */
  async #onMutation(event: Interception, caps: AdapterCapabilities): Promise<Verdict> {
    const ref = event.transcript
    if (!ref) return allow()

    let restorable: string[] = []
    let detections: Detection[] = []
    let predicates: Predicate[] = []
    let uncompilable = 0

    try {
      const boundaries = await findCompactBoundaries(ref.path)
      const latest = boundaries.at(-1)
      if (!latest) return allow()

      const windows = await sliceWindows(ref.path, latest)
      if (!windows.groundTruthAvailable) {
        // Saying "nothing was lost" here would be a lie: the dropped content
        // lives in another session's transcript and cannot be measured.
        return {
          protocolVersion: PROTOCOL_VERSION,
          decision: 'warn',
          reason: 'ground_truth_unavailable',
          message:
            'The dropped content lives in another session’s transcript, so nothing could be verified. ' +
            'This is NOT the same as "nothing was lost".',
          detections: [
            { detector: 'capture', severity: 'info', detail: 'Ground truth unavailable for this mutation.' },
          ],
        }
      }

      const dropped = extractAll(windows.dropped, event.cwd ? { cwd: event.cwd } : {})
      const surviving = survivingText(windows)

      const constraints = dropped.filter((i) => i.kind === 'constraint')
      const lost = detectSurvival(constraints, surviving).verdicts.filter((v) => v.survival === 'lost')

      const compiled = compileConstraints(constraints)
      predicates = compiled.predicates
      uncompilable = compiled.uncompilable.length

      // Constraints first: a forgotten rule causes wrong actions, while a
      // forgotten file path only causes a re-read.
      restorable = lost.map((v) => v.item.value)

      detections = lost.map((v) => ({
        detector: 'D1',
        severity: 'critical' as const,
        detail: `constraint did not survive compaction: "${v.item.value.slice(0, 120)}"`,
        itemKind: 'constraint' as const,
        value: v.item.value,
      }))
    } catch (err) {
      logger.error('mutation analysis failed', { err: String(err) })
      return allow()
    }

    this.#sessions.set(event.sessionId, {
      predicates,
      restorable,
      uncompilable,
      lastMutationTs: event.ts,
    })

    if (restorable.length === 0) return allow(detections)

    // Rung 3: repair, if the adapter can and the budget allows.
    if (caps.repair && this.#mode !== 'observe') {
      const budget = fitToBudget(restorable, this.#budget)
      if (budget.overBudget && budget.restore.length === 0) {
        // Nothing fits. Escalating beats proceeding silently.
        return escalate(
          'repair_budget_exceeded',
          `${restorable.length} constraint(s) were dropped and none fit the repair budget. Human review needed.`,
          detections,
        )
      }
      return transform(
        { restore: budget.restore, estimatedTokens: budget.estimatedTokens },
        budget.overBudget
          ? `Restored ${budget.restore.length} of ${restorable.length} dropped constraints; ${budget.dropped.length} did not fit the budget. Note: re-injection invalidates the prompt cache downstream.`
          : `Restored ${budget.restore.length} dropped constraint(s). Note: re-injection invalidates the prompt cache downstream.`,
        detections,
      )
    }

    // Rung 4/5 only: this adapter cannot repair, so report and keep the rules
    // for the tool-call gate.
    return warn(
      `${restorable.length} constraint(s) did not survive compaction. ${caps.repair ? '' : `${event.adapter} cannot repair inline; rules will be enforced at the tool call.`}`.trim(),
      detections,
    )
  }

  /** Rung 4: block the consequence, never the mechanism. */
  #onAction(event: Interception, caps: AdapterCapabilities, ctx: { repo: Repo }): Verdict {
    const state = this.#sessions.get(event.sessionId)
    if (!state || state.predicates.length === 0 || !event.toolCall) return allow()

    const violations = evaluateAll(state.predicates, event.toolCall)
    if (violations.length === 0) return allow()

    const first = violations[0]!
    const detections: Detection[] = violations.map((v) => ({
      detector: 'D5',
      severity: 'critical' as const,
      detail: `${v.toolName} ${v.predicate.explanation}`,
      itemKind: 'constraint' as const,
      value: v.predicate.source.value,
    }))

    for (const v of violations) {
      try {
        ctx.repo.recordViolation({
          sessionId: event.sessionId,
          interceptionPoint: event.point,
          toolName: v.toolName,
          toolInput: event.toolCall.input,
          verdict: this.#mode === 'block' ? 'deny' : 'warn',
          ts: event.ts,
        })
      } catch (err) {
        logger.error('failed to record violation', { err: String(err) })
      }
    }

    const message =
      `This ${first.toolName} call breaks a rule you set before the last compaction, which the agent no longer has in context:\n` +
      `  rule: "${first.predicate.source.value}"\n` +
      `  check: ${first.predicate.explanation}`

    if (this.#mode === 'block' && caps.block) return deny('constraint_violation', message, detections)
    return warn(message, detections)
  }
}

export function createGate(opts: GateOptions = {}): Gate {
  return new Gate(opts)
}
