import { createHash } from 'node:crypto'

/**
 * An item that ought to survive a context mutation.
 *
 * `norm` is the canonical form and the only thing survival is ever tested
 * against — exact match on a canonical string, never fuzzy comparison. If we
 * cannot say precisely whether something survived, we do not get to claim we
 * measured it.
 */
export interface ExtractedItem {
  kind: 'constraint' | 'artifact' | 'commitment'
  /** Narrower type, for reporting: 'file' | 'command' | 'error' | 'branch' | 'rule' | 'todo'. */
  subtype: string
  /** As it appeared, for display. */
  value: string
  /** Canonical form, for comparison. */
  norm: string
  hash: string
  /**
   * How much we trust this extraction.
   *
   * Not decoration. Constraint extraction is linguistic and therefore
   * imprecise; artifact extraction is structural and near-exact. Reporting them
   * as one undifferentiated number would overstate what we know.
   */
  confidence: 'high' | 'medium'
  /** uuid of the transcript entry it came from. */
  sourceRef?: string
}

export function makeItem(
  kind: ExtractedItem['kind'],
  subtype: string,
  value: string,
  norm: string,
  confidence: ExtractedItem['confidence'] = 'high',
  sourceRef?: string,
): ExtractedItem {
  return {
    kind,
    subtype,
    value,
    norm,
    hash: createHash('sha256').update(`${kind}:${subtype}:${norm}`).digest('hex').slice(0, 16),
    confidence,
    ...(sourceRef ? { sourceRef } : {}),
  }
}

/** Collapse whitespace, lowercase, strip surrounding punctuation. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'`*_\-–—•>#[\]()]+|[\s"'`*_.,;:!]+$/g, '')
    .trim()
}

/** Deduplicate by hash, keeping the first occurrence and the highest confidence seen. */
export function dedupe(items: ExtractedItem[]): ExtractedItem[] {
  const byHash = new Map<string, ExtractedItem>()
  for (const item of items) {
    const existing = byHash.get(item.hash)
    if (!existing) {
      byHash.set(item.hash, item)
    } else if (existing.confidence === 'medium' && item.confidence === 'high') {
      byHash.set(item.hash, { ...existing, confidence: 'high' })
    }
  }
  return [...byHash.values()]
}
