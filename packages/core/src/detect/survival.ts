import type { ExtractedItem } from '../extract/types.js'
import { normalizeText } from '../extract/types.js'

/**
 * D1–D3: did the things that mattered survive the mutation?
 *
 * THE MEASUREMENT PROBLEM, stated up front because it governs how every number
 * below should be read:
 *
 * A compaction summary PARAPHRASES. "dont put comment in code" may survive
 * perfectly as "the user asked for no code comments" — semantically intact,
 * lexically absent. So exact matching over-reports loss, and loose matching
 * under-reports it.
 *
 * We refuse to paper over that with a single confident number. Every item lands
 * in one of three buckets, and `uncertain` is a real answer rather than a
 * rounding error:
 *
 *   survived  — found verbatim in surviving context. Certain.
 *   uncertain — most of its distinctive words are present, but not the phrase.
 *               Probably paraphrased; possibly coincidence.
 *   lost      — little or none of it is present. Certain enough to act on.
 *
 * Artifacts barely use `uncertain`: a file path either appears or it does not.
 * Constraints use it heavily, which is exactly the honest result.
 */

export type Survival = 'survived' | 'uncertain' | 'lost'

export interface SurvivalVerdict {
  item: ExtractedItem
  survival: Survival
  /** Fraction of distinctive tokens present in surviving text, 0–1. */
  overlap: number
}

/** Words too common to carry evidence of survival. */
const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','than','that','this','these','those','is','are','was','were','be','been',
  'do','does','did','dont','do not','not','no','to','of','in','on','for','with','at','by','from','as','it','its','we',
  'you','your','i','my','me','us','our','they','them','so','just','only','also','can','will','would','should','need',
  'needs','make','sure','use','used','using','now','get','got','let','lets','all','any','some','more','very','too',
])

export function contentTokens(text: string): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9_/.@-]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
}

/**
 * Overlap threshold above which we say "probably paraphrased" rather than
 * "lost". Chosen conservatively: at 0.6 a constraint must share most of its
 * distinctive words with the surviving text before we decline to call it lost.
 */
export const UNCERTAIN_THRESHOLD = 0.6

export function judgeSurvival(item: ExtractedItem, survivingText: string): SurvivalVerdict {
  const haystack = normalizeText(survivingText)

  // Exact presence is the only thing we treat as certain survival.
  if (item.norm && haystack.includes(item.norm)) {
    return { item, survival: 'survived', overlap: 1 }
  }

  const tokens = contentTokens(item.value)
  if (tokens.length === 0) {
    // Nothing distinctive to look for; refuse to guess.
    return { item, survival: 'uncertain', overlap: 0 }
  }

  const haystackTokens = new Set(contentTokens(survivingText))
  const present = tokens.filter((t) => haystackTokens.has(t)).length
  const overlap = present / tokens.length

  return { item, survival: overlap >= UNCERTAIN_THRESHOLD ? 'uncertain' : 'lost', overlap }
}

export interface SurvivalSummary {
  total: number
  survived: number
  uncertain: number
  lost: number
  /** lost / total. The headline, but never quotable without `uncertain`. */
  lostRate: number
  verdicts: SurvivalVerdict[]
}

export function summarise(verdicts: SurvivalVerdict[]): SurvivalSummary {
  const survived = verdicts.filter((v) => v.survival === 'survived').length
  const uncertain = verdicts.filter((v) => v.survival === 'uncertain').length
  const lost = verdicts.filter((v) => v.survival === 'lost').length
  return {
    total: verdicts.length,
    survived,
    uncertain,
    lost,
    lostRate: verdicts.length ? lost / verdicts.length : 0,
    verdicts,
  }
}

/** Judge every dropped item against what remains. */
export function detectSurvival(droppedItems: ExtractedItem[], survivingText: string): SurvivalSummary {
  return summarise(droppedItems.map((item) => judgeSurvival(item, survivingText)))
}
