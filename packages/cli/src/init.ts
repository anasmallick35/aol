import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

/**
 * Register the hook dispatch in Claude Code settings.
 *
 * Settings are the user's file, not ours: we merge, back up before writing, and
 * never remove a hook we did not add.
 */

/**
 * How we recognise a hook entry as ours.
 *
 * A literal substring does not work: the default command is
 * `npx -y @aol/cli hook`, which does not contain "aol hook" — it contains
 * "@aol/cli hook". Matching literally made `init` non-idempotent and
 * duplicated every hook on a second run.
 *
 * KNOWN LIMIT: a fully custom `--command` with no "aol" in it (say
 * `node dist/cli.js hook`) will not be recognised, so re-running init would
 * add a second entry. Documented rather than solved, because writing a private
 * marker field into the user's settings file is worse.
 */
const AOL_MARKER = /aol.*\bhook\b/i

/**
 * Events we register for.
 *
 * Compaction and session events only, deliberately. Claude Code invokes a hook
 * as a fresh process, measured at ~157ms per call (≈102ms node startup plus
 * ≈55ms npx resolution). PreToolUse and PostToolUse fire on EVERY tool call, so
 * registering them would add roughly 300ms per tool call — minutes across a
 * long session — for data nothing reads until M4 and M5.
 *
 * The events below fire once per compaction or per session, so their cost is
 * irrelevant. Tool hooks get added in M4/M5, when they buy something.
 *
 * The dispatcher in hooks.ts still handles tool events, so a user who registers
 * them by hand works correctly. This list only governs what `aol init` writes.
 */
export const HOOK_EVENTS = ['PreCompact', 'PostCompact', 'SessionStart', 'SessionEnd'] as const

interface HookCommand { type: string; command: string; timeout?: number }
interface HookMatcher { matcher?: string; hooks: HookCommand[] }
type Settings = Record<string, unknown> & { hooks?: Record<string, HookMatcher[]> }

export function settingsPath(scope: 'user' | 'project' = 'user', cwd = process.cwd()): string {
  return scope === 'user' ? join(homedir(), '.claude', 'settings.json') : join(cwd, '.claude', 'settings.json')
}

export function buildHookEntry(command: string): HookMatcher {
  return { hooks: [{ type: 'command', command, timeout: 10 }] }
}

/** Merge our hooks into existing settings without disturbing anything else. */
export function mergeHooks(settings: Settings, command: string): { settings: Settings; added: string[]; skipped: string[] } {
  const out: Settings = { ...settings, hooks: { ...(settings.hooks ?? {}) } }
  const added: string[] = []
  const skipped: string[] = []

  for (const event of HOOK_EVENTS) {
    const existing = out.hooks![event] ?? []
    const alreadyOurs = existing.some((m) => m.hooks?.some((h) => AOL_MARKER.test(h.command ?? '')))
    if (alreadyOurs) {
      skipped.push(event)
      continue
    }
    out.hooks![event] = [...existing, buildHookEntry(command)]
    added.push(event)
  }
  return { settings: out, added, skipped }
}

export interface InitResult {
  path: string
  backup?: string
  added: string[]
  skipped: string[]
  dryRun: boolean
}

export function initHooks(opts: { scope?: 'user' | 'project'; command?: string; dryRun?: boolean; cwd?: string } = {}): InitResult {
  const path = settingsPath(opts.scope ?? 'user', opts.cwd)
  const command = opts.command ?? 'npx -y @aol/cli hook'

  let current: Settings = {}
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, 'utf8')) as Settings
    } catch (err) {
      // Refuse rather than overwrite: clobbering a user's settings because we
      // could not parse them would be unforgivable.
      throw new Error(`${path} is not valid JSON (${String(err)}). Fix or move it before running init.`)
    }
  }

  const { settings, added, skipped } = mergeHooks(current, command)
  if (opts.dryRun) return { path, added, skipped, dryRun: true }

  mkdirSync(dirname(path), { recursive: true })
  let backup: string | undefined
  if (existsSync(path)) {
    backup = `${path}.aol-backup`
    copyFileSync(path, backup)
  }
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n')
  return { path, ...(backup ? { backup } : {}), added, skipped, dryRun: false }
}
