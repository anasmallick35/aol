import { appendFileSync } from 'node:fs'
import { ensureHome, errorLogPath } from './paths.js'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function threshold(): number {
  const raw = (process.env.AOL_LOG_LEVEL ?? 'info') as Level | 'silent'
  if (raw === 'silent') return Number.POSITIVE_INFINITY
  return LEVELS[raw as Level] ?? LEVELS.info
}

/**
 * Logging never throws.
 *
 * An adapter runs inside somebody's agent. A failure to write a log file must
 * never be the thing that takes down their run.
 */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] < threshold()) return
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields })
  try {
    if (level === 'error' || level === 'warn') {
      ensureHome()
      appendFileSync(errorLogPath(), line + '\n')
    }
    if (process.env.AOL_LOG_STDERR === '1' || level === 'error') {
      process.stderr.write(line + '\n')
    }
  } catch {
    // Deliberately swallowed.
  }
}

export const logger = {
  debug: (m: string, f?: Record<string, unknown>) => log('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => log('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => log('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => log('error', m, f),
}
