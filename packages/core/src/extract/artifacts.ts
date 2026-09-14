import { makeItem, normalizeText, type ExtractedItem } from './types.js'
import { extractText, type TranscriptEntry } from '../capture/transcript.js'
import { isAbsolute, normalize as normalizePath } from 'node:path'

/**
 * Artifacts: the hard facts an agent established by doing work.
 *
 * Unlike constraints, these are structural. A `file_path` in an Edit call is
 * not inferred from prose — it is a field. That makes this the most reliable
 * extractor we have, and the one the headline numbers should lean on.
 */

interface ToolUseBlock {
  type?: string
  name?: string
  input?: Record<string, unknown>
}

/** Tool inputs whose value names a file. */
const FILE_PATH_KEYS = ['file_path', 'path', 'notebook_path', 'filePath'] as const
/** Tool inputs whose value is a shell command. */
const COMMAND_KEYS = ['command', 'cmd'] as const

/** Paths mentioned in prose. Deliberately strict — a bare word is not a path. */
const PATH_IN_TEXT =
  /(?:^|[\s"'`([])((?:\/|\.\.?\/|~\/)[\w.@+-]+(?:\/[\w.@+-]+)*\.\w{1,8}|\b[\w.@-]+\/[\w.@/-]+\.\w{1,8})/g

/** Error strings worth remembering. */
const ERROR_IN_TEXT =
  /\b((?:Error|TypeError|ReferenceError|SyntaxError|RangeError|AssertionError|ENOENT|EACCES|EADDRINUSE|ECONNREFUSED|TS\d{4}|E\d{3}):?\s?[^\n]{0,120})/g

function toolUseBlocks(entry: TranscriptEntry): ToolUseBlock[] {
  const content = entry.message?.content
  if (!Array.isArray(content)) return []
  return content.filter(
    (b): b is ToolUseBlock => typeof b === 'object' && b !== null && (b as ToolUseBlock).type === 'tool_use',
  )
}

/** Canonical path form so `./src/a.ts` and `src/a.ts` compare equal. */
export function normalizeFilePath(p: string, cwd?: string): string {
  let out = p.trim().replace(/^["'`]|["'`]$/g, '')
  if (out.startsWith('~/')) out = out.slice(2)
  out = normalizePath(out)
  if (cwd && isAbsolute(out) && out.startsWith(cwd)) out = out.slice(cwd.length).replace(/^\//, '')
  return out.replace(/^\.\//, '').toLowerCase()
}

/** Drop volatile parts so the same command run twice compares equal. */
export function normalizeCommand(cmd: string): string {
  return cmd
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\d{10,}\b/g, 'N') // timestamps, pids
    .toLowerCase()
    .slice(0, 300)
}

export interface ArtifactOptions {
  cwd?: string
  /** Include paths and errors found in prose, not just tool fields. Lower precision. */
  includeProse?: boolean
}

export function extractArtifacts(entries: TranscriptEntry[], opts: ArtifactOptions = {}): ExtractedItem[] {
  const out: ExtractedItem[] = []
  const cwd = opts.cwd ? normalizePath(opts.cwd).replace(/\/$/, '') : undefined

  for (const entry of entries) {
    // --- structural: tool call fields. High confidence, these are not guesses.
    for (const block of toolUseBlocks(entry)) {
      const input = block.input
      if (!input) continue

      for (const key of FILE_PATH_KEYS) {
        const raw = input[key]
        if (typeof raw !== 'string' || !raw.trim()) continue
        out.push(makeItem('artifact', 'file', raw, normalizeFilePath(raw, cwd), 'high', entry.uuid))
      }

      for (const key of COMMAND_KEYS) {
        const raw = input[key]
        if (typeof raw !== 'string' || !raw.trim()) continue
        out.push(makeItem('artifact', 'command', raw, normalizeCommand(raw), 'high', entry.uuid))
      }
    }

    if (!opts.includeProse) continue

    // --- prose: lower confidence. A path in a sentence may be hypothetical.
    const text = extractText(entry.message?.content)
    if (!text) continue

    for (const match of text.matchAll(PATH_IN_TEXT)) {
      const raw = match[1]
      if (!raw) continue
      out.push(makeItem('artifact', 'file', raw, normalizeFilePath(raw, cwd), 'medium', entry.uuid))
    }
    for (const match of text.matchAll(ERROR_IN_TEXT)) {
      const raw = match[1]?.trim()
      if (!raw) continue
      out.push(makeItem('artifact', 'error', raw, normalizeText(raw), 'medium', entry.uuid))
    }
  }
  return out
}
