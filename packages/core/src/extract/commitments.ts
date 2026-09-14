import { makeItem, normalizeText, type ExtractedItem } from './types.js'
import type { TranscriptEntry } from '../capture/transcript.js'

/**
 * Commitments: work the agent said it would do and has not finished.
 *
 * Structurally the strongest signal we have — the data is already a list with
 * explicit statuses, so there is nothing to infer. An unfinished task that
 * vanishes at compaction is work silently abandoned.
 *
 * ⚠️ UNVERIFIED AGAINST REAL DATA. None of the 40 local transcripts used
 * TodoWrite, TaskCreate or TaskUpdate, so this extractor is written to the
 * documented tool shapes and tested only against fixtures. Treat its output as
 * unconfirmed until a real transcript exercises it — unlike constraints and
 * artifacts, which were both tuned against real transcript content.
 */

const TODO_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])

/** Statuses meaning "not finished". Anything unrecognised counts as open. */
const CLOSED_STATUSES = new Set(['completed', 'done', 'cancelled', 'canceled'])

interface ToolUseBlock {
  type?: string
  name?: string
  input?: Record<string, unknown>
}

interface TodoLike {
  content?: unknown
  title?: unknown
  description?: unknown
  status?: unknown
  state?: unknown
}

function toolUseBlocks(entry: TranscriptEntry): ToolUseBlock[] {
  const content = entry.message?.content
  if (!Array.isArray(content)) return []
  return content.filter(
    (b): b is ToolUseBlock => typeof b === 'object' && b !== null && (b as ToolUseBlock).type === 'tool_use',
  )
}

function todoText(t: TodoLike): string | undefined {
  for (const field of [t.content, t.title, t.description]) {
    if (typeof field === 'string' && field.trim()) return field.trim()
  }
  return undefined
}

export function isOpen(t: TodoLike): boolean {
  const status = t.status ?? t.state
  if (typeof status !== 'string') return true
  return !CLOSED_STATUSES.has(status.toLowerCase())
}

/**
 * Extract open commitments.
 *
 * Later calls supersede earlier ones for the same task: TodoWrite rewrites the
 * whole list each time, so a task marked completed in a later call must not
 * still count as open from an earlier one.
 */
export function extractCommitments(entries: TranscriptEntry[]): ExtractedItem[] {
  const latestByNorm = new Map<string, { item: ExtractedItem; open: boolean }>()

  for (const entry of entries) {
    for (const block of toolUseBlocks(entry)) {
      if (!block.name || !TODO_TOOLS.has(block.name)) continue
      const input = block.input
      if (!input) continue

      const raw = input.todos ?? input.tasks ?? input.task
      const list: TodoLike[] = Array.isArray(raw) ? (raw as TodoLike[]) : raw ? [raw as TodoLike] : []

      for (const todo of list) {
        const text = todoText(todo)
        if (!text) continue
        const norm = normalizeText(text)
        if (!norm) continue
        latestByNorm.set(norm, {
          item: makeItem('commitment', 'todo', text, norm, 'high', entry.uuid),
          open: isOpen(todo),
        })
      }
    }
  }

  return [...latestByNorm.values()].filter((e) => e.open).map((e) => e.item)
}
