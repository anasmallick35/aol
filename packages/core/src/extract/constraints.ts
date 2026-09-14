import { makeItem, normalizeText, type ExtractedItem } from './types.js'
import { extractText, type TranscriptEntry } from '../capture/transcript.js'

/**
 * Constraints: standing instructions the user gave the agent.
 *
 * THE HONEST CAVEAT, because it governs how the output should be read: this is
 * the only linguistic extractor we have, and it is therefore the least precise.
 * Artifacts and commitments are structural and near-exact; constraints are
 * inferred from free text written by a human in a hurry.
 *
 * Tuned against 11,216 real clauses from 564 real user turns. A naive keyword
 * match ("never", "always", "must") fired on 81 of 444 turns and was mostly
 * noise — questions like "should we remove that doc?" and statements like "i
 * still dont understand" both matched. The rules below are deliberately
 * conservative: measured on that corpus they extract 0.30% of clauses at
 * roughly 94% precision. **We would rather find ten real constraints than a
 * hundred maybes**, because a survival rate computed over noise is worse than
 * no number at all.
 *
 * Known residual false positives from that corpus: answers phrased as commands
 * ("never measure this") and questions written without a question mark
 * ("dont we need to create a hooks").
 */

/**
 * URLs wreck clause splitting and are never constraints.
 *
 * Deliberately does NOT consume trailing punctuation: eating the '.' at the end
 * of "see https://x/y. never edit prod" would merge two clauses into one and
 * lose the constraint entirely.
 */
const URL = /https?:\/\/\S*[^\s.,;:!?)\]]|\bwww\.\S*[^\s.,;:!?)\]]/g
const LEAD_MARKUP = /^[\s>*#\-–—•`_[\]()]+/

const QUESTION_OPENER =
  /^(is|are|was|were|should|shall|can|could|would|will|do|does|did|have|has|why|what|how|when|where|who|which)\b/i

/**
 * Subjects that make a clause descriptive rather than directive.
 * "The replication engine always runs a pull leg" describes a system; it does
 * not instruct the agent.
 */
const NON_DIRECTIVE_SUBJECT =
  /^(i|we|my|our|it|he|she|they|there|this|that|these|those|the\s+\w+|an?\s+\w+|every\s+\w+|each\s+\w+|both\s+\w+|so\s+the\s+\w+)\s+/i

const IMPERATIVE =
  /^(never|always|avoid|ensure|make sure|be sure|remember to|keep|prefer|follow|stick to|do\s?n[o']?t|don't|do not|only\s+(use|do|run|edit|touch|change|modify))\b/i

const SECOND_PERSON = /^you\s+(must|should|need to|have to|shouldn't|mustn't|never|always)\b/i

const USE_X_NOT_Y = /^use\b.{0,60}\b(not|instead of|rather than|only)\b/i

export const MIN_CLAUSE_LENGTH = 8
export const MAX_CLAUSE_LENGTH = 250

/**
 * Split a turn into clauses. A turn is not a constraint; a clause is.
 *
 * Sentence punctuation only counts as a boundary when followed by whitespace or
 * end of string. Splitting on every '.' tore `never edit src/prod.ts` into
 * "never edit src/prod" and "ts" — losing the path, and with it any chance of
 * compiling the constraint into a predicate. Version numbers and decimals had
 * the same problem.
 */
export function splitClauses(text: string): string[] {
  return text
    .replace(URL, ' ')
    .split(/[.!?;]+(?=\s|$)|[\n]+|,\s+/)
    .map((c) => c.replace(LEAD_MARKUP, '').trim())
    .filter(Boolean)
}

/** Returns a confidence if the clause reads as an instruction, else null. */
export function classifyClause(clause: string): 'high' | null {
  if (clause.length < MIN_CLAUSE_LENGTH || clause.length > MAX_CLAUSE_LENGTH) return null
  if (clause.trimEnd().endsWith('?')) return null
  if (QUESTION_OPENER.test(clause)) return null
  if (NON_DIRECTIVE_SUBJECT.test(clause)) return null
  if (SECOND_PERSON.test(clause) || IMPERATIVE.test(clause) || USE_X_NOT_Y.test(clause)) return 'high'
  return null
}

/**
 * Extract constraints from user turns only.
 *
 * Assistant turns are excluded deliberately: an agent restating a rule is not
 * the user setting one, and counting its own words would let it manufacture
 * constraints it then claims credit for preserving.
 */
export function extractConstraints(entries: TranscriptEntry[]): ExtractedItem[] {
  const out: ExtractedItem[] = []
  for (const entry of entries) {
    if (entry.type !== 'user' || entry.isCompactSummary) continue
    const text = extractText(entry.message?.content)
    if (!text) continue
    for (const clause of splitClauses(text)) {
      const confidence = classifyClause(clause)
      if (!confidence) continue
      const norm = normalizeText(clause)
      if (!norm) continue
      out.push(makeItem('constraint', 'rule', clause, norm, confidence, entry.uuid))
    }
  }
  return out
}
