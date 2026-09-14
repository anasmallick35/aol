/**
 * Repair budget.
 *
 * Repair is not free, in two ways that both have to be surfaced rather than
 * hidden:
 *
 *  1. TOKENS. Compaction fired because the context was full. Re-injecting the
 *     dropped items costs context, and the critical set may simply not fit.
 *     When it does not, we escalate to a human instead of silently proceeding.
 *
 *  2. CACHE. Prompt caching needs an exact prefix match. Modifying the
 *     compacted prefix invalidates it and forfeits the ~90% cached-input
 *     discount on everything downstream. So repair trades cache savings for
 *     integrity, and the report must show the trade.
 */

/** Rough token estimate. Deliberately crude and documented as such. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export interface BudgetDecision {
  /** Items that fit and will be restored. */
  restore: string[]
  /** Items that did not fit. Non-empty means a human should be asked. */
  dropped: string[]
  estimatedTokens: number
  /** True when something had to be left out. */
  overBudget: boolean
}

export interface BudgetOptions {
  /** Tokens available for repair. */
  maxTokens?: number
}

export const DEFAULT_REPAIR_BUDGET_TOKENS = 2000

/**
 * Fit as many items as the budget allows, highest priority first.
 *
 * Order is the caller's: constraints before artifacts, because a forgotten
 * rule causes wrong actions while a forgotten file path merely causes a re-read.
 */
export function fitToBudget(items: string[], opts: BudgetOptions = {}): BudgetDecision {
  const max = opts.maxTokens ?? DEFAULT_REPAIR_BUDGET_TOKENS
  const restore: string[] = []
  const dropped: string[] = []
  let used = 0

  for (const item of items) {
    const cost = estimateTokens(item)
    if (used + cost <= max) {
      restore.push(item)
      used += cost
    } else {
      dropped.push(item)
    }
  }

  return { restore, dropped, estimatedTokens: used, overBudget: dropped.length > 0 }
}
