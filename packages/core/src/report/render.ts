import type { DetectionReport } from '../detect/index.js'
import type { SurvivalSummary } from '../detect/survival.js'

/**
 * Terminal rendering.
 *
 * Two rules this file exists to enforce:
 *  1. A loss figure is NEVER shown without its control alongside it.
 *  2. `uncertain` is never folded into either `survived` or `lost`.
 *
 * Both are easy to violate for a tidier-looking report, and both would make the
 * output dishonest.
 */

export interface RenderOptions {
  /** Show the individual items behind each number. */
  verbose?: boolean
  color?: boolean
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

function bar(summary: SurvivalSummary, width = 24): string {
  if (summary.total === 0) return '─'.repeat(width)
  const seg = (n: number) => Math.round((n / summary.total) * width)
  const s = seg(summary.survived)
  const u = seg(summary.uncertain)
  const l = Math.max(0, width - s - u)
  return '█'.repeat(s) + '▒'.repeat(u) + '░'.repeat(l)
}

function line(label: string, m: SurvivalSummary, c: SurvivalSummary): string {
  const head = `  ${label.padEnd(12)} ${String(m.total).padStart(5)} items  ${bar(m)}`
  const nums = `  survived ${String(m.survived).padStart(4)}   uncertain ${String(m.uncertain).padStart(4)}   lost ${String(m.lost).padStart(4)}`
  const ctrl =
    c.total === 0
      ? '  control: no comparable items'
      : `  control: lost ${pct(c.lostRate)} of ${c.total}   →   ${verdictWord(m.lostRate, c.lostRate, m.total, c.total)}`
  return [head, nums, ctrl].join('\n')
}

/**
 * The comparison sentence.
 *
 * Deliberately refuses to claim anything when the sample is small. Two items
 * lost out of three is not a signal, however dramatic the percentage looks.
 */
function verdictWord(mutationRate: number, controlRate: number, mTotal: number, cTotal: number): string {
  if (mTotal < 5 || cTotal < 5) return 'sample too small to compare'
  const delta = mutationRate - controlRate
  if (delta > 0.2) return `ABOVE baseline by ${pct(delta)}`
  if (delta < -0.2) return `below baseline by ${pct(-delta)}`
  return 'indistinguishable from baseline'
}

export function renderReport(r: DetectionReport, opts: RenderOptions = {}): string {
  const out: string[] = []

  if (!r.groundTruthAvailable) {
    out.push('  ⚠ Ground truth unavailable for this event.')
    out.push('    The dropped content lives in another session’s transcript, so nothing')
    out.push('    below can be measured. This is NOT the same as "nothing was lost".')
    return out.join('\n')
  }

  out.push('  █ survived   ▒ uncertain (likely paraphrased)   ░ lost')
  out.push('')
  out.push(line('constraints', r.constraints, r.control.constraints))
  out.push('')
  out.push(line('artifacts', r.artifacts, r.control.artifacts))
  out.push('')
  out.push(line('commitments', r.commitments, r.control.commitments))
  out.push('')
  out.push(
    `  redundant work  ${r.redundancy.redundant.length} of ${r.redundancy.priorTargets} prior targets re-read after the cut` +
      `   (control: ${r.control.redundancy.redundant.length} of ${r.control.redundancy.priorTargets})`,
  )
  out.push('')

  // D5. Coverage is printed alongside the count and never separately: a
  // violation total means nothing without knowing what share of the rules
  // could be mechanically checked at all.
  const v = r.violations
  const coveragePct = pct(r.compiled.coverage)
  out.push(
    `  RULE VIOLATIONS  ${v.violations.length}` +
      `   (control: ${r.control.violations.violations.length})`,
  )
  out.push(
    `    checked ${v.predicatesChecked} of ${r.compiled.predicates.length + r.compiled.uncompilable.length} constraints` +
      ` (${coveragePct} mechanically checkable) against ${v.callsChecked} tool calls`,
  )
  if (r.compiled.uncompilable.length) {
    out.push(`    ${r.compiled.uncompilable.length} constraint(s) could not be compiled into a check — not counted either way`)
  }

  if (opts.verbose) {
    const lost = r.constraints.verdicts.filter((v) => v.survival === 'lost')
    if (lost.length) {
      out.push('')
      out.push('  constraints judged lost:')
      for (const v of lost.slice(0, 20)) {
        out.push(`    ✗ ${v.item.value.slice(0, 100)}  (overlap ${pct(v.overlap)})`)
      }
    }
    const uncertain = r.constraints.verdicts.filter((v) => v.survival === 'uncertain')
    if (uncertain.length) {
      out.push('')
      out.push('  constraints possibly paraphrased:')
      for (const v of uncertain.slice(0, 10)) {
        out.push(`    ? ${v.item.value.slice(0, 100)}  (overlap ${pct(v.overlap)})`)
      }
    }
    if (r.violations.violations.length) {
      out.push('')
      out.push('  violations:')
      for (const x of r.violations.violations.slice(0, 15)) {
        out.push(`    ⚠ ${x.toolName} — ${x.predicate.explanation}`)
        out.push(`      rule:    "${x.predicate.source.value.slice(0, 90)}"`)
        out.push(`      matched: ${x.field}=${x.matched.slice(0, 80).replace(/\n/g, ' ')}`)
      }
    }
    if (r.compiled.uncompilable.length) {
      out.push('')
      out.push('  constraints with no mechanical check (neither enforced nor counted):')
      for (const i of r.compiled.uncompilable.slice(0, 10)) out.push(`    – ${i.value.slice(0, 100)}`)
    }
    if (r.redundancy.redundant.length) {
      out.push('')
      out.push('  re-read after the cut:')
      for (const x of r.redundancy.redundant.slice(0, 15)) out.push(`    ↻ ${x.target.slice(0, 100)}`)
    }
  }

  return out.join('\n')
}
