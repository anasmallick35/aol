import Database from 'better-sqlite3'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { dbPath } from '../paths.js'
import { MIGRATIONS } from './schema.js'

export type DB = Database.Database

/**
 * better-sqlite3 rather than node:sqlite because our floor is Node 22, where
 * node:sqlite is still experimental. Synchronous by design: the daemon's
 * critical sections are short and an async driver would buy nothing but
 * ceremony. See docs/07 §S4.
 */
export function openDb(path: string = dbPath()): DB {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  migrate(db)
  return db
}

export function migrate(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)')
  const applied = new Set(
    db.prepare('SELECT id FROM _migrations').all().map((r) => (r as { id: number }).id),
  )
  const record = db.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)')
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    db.transaction(() => {
      db.exec(m.sql)
      record.run(m.id, m.name, Date.now())
    })()
  }
}
