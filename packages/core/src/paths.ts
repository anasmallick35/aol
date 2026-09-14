import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

/**
 * Everything AOL writes lives under one directory the user can inspect or
 * delete. Nothing leaves the machine in P1/P2 — for a product selling
 * integrity, local-only is the trust argument, not a limitation.
 */
export function aolHome(): string {
  return process.env.AOL_HOME ?? join(homedir(), '.aol')
}

export function ensureHome(): string {
  const dir = aolHome()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

export function dbPath(): string {
  return process.env.AOL_DB ?? join(aolHome(), 'aol.db')
}

/**
 * Socket path.
 *
 * Unix domain socket paths are capped near 104 bytes on macOS, and a long
 * $HOME can breach that, so we fall back to the temp directory rather than
 * failing at bind time with a confusing error.
 */
export function socketPath(): string {
  if (process.env.AOL_SOCKET) return process.env.AOL_SOCKET
  const preferred = join(aolHome(), 'aol.sock')
  return preferred.length < 100 ? preferred : join(tmpdir(), 'aol.sock')
}

export function errorLogPath(): string {
  return join(aolHome(), 'error.log')
}
