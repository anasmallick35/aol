import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

/**
 * Everything ContextKeep writes lives under one directory the user can inspect or
 * delete. Nothing leaves the machine in P1/P2 — for a product selling
 * integrity, local-only is the trust argument, not a limitation.
 */
export function contextKeepHome(): string {
  return process.env.CONTEXTKEEP_HOME ?? join(homedir(), '.contextkeep')
}

export function ensureHome(): string {
  const dir = contextKeepHome()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

export function dbPath(): string {
  return process.env.CONTEXTKEEP_DB ?? join(contextKeepHome(), 'contextkeep.db')
}

/**
 * Socket path.
 *
 * Unix domain socket paths are capped near 104 bytes on macOS, and a long
 * $HOME can breach that, so we fall back to the temp directory rather than
 * failing at bind time with a confusing error.
 */
export function socketPath(): string {
  if (process.env.CONTEXTKEEP_SOCKET) return process.env.CONTEXTKEEP_SOCKET
  const preferred = join(contextKeepHome(), 'contextkeep.sock')
  return preferred.length < 100 ? preferred : join(tmpdir(), 'contextkeep.sock')
}

export function errorLogPath(): string {
  return join(contextKeepHome(), 'error.log')
}
