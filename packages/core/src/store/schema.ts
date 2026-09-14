/**
 * Schema.
 *
 * Defined in full here rather than grown milestone by milestone. Every
 * downstream milestone touches these tables, and a schema that churns is the
 * main source of merge conflicts in a stacked-PR workflow.
 * See docs/08-working-agreement.md.
 */

export interface Migration {
  readonly id: number
  readonly name: string
  readonly sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
      CREATE TABLE sessions (
        id          TEXT PRIMARY KEY,
        adapter     TEXT NOT NULL,
        framework   TEXT,
        cwd         TEXT,
        git_branch  TEXT,
        first_seen  INTEGER NOT NULL,
        last_seen   INTEGER NOT NULL
      );

      -- One row per context mutation, plus one per matched control window.
      -- The control row is not bookkeeping: without a baseline, "the agent
      -- re-read a file" is indistinguishable from normal behaviour, and every
      -- detector number is meaningless. See docs/06 §4.
      CREATE TABLE events (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id     TEXT NOT NULL REFERENCES sessions(id),
        kind           TEXT NOT NULL CHECK (kind IN ('mutation','control')),
        mutation_type  TEXT,
        trigger        TEXT,
        cut_ref        TEXT,
        cut_ts         INTEGER,
        pre_tokens     INTEGER,
        post_tokens    INTEGER,
        created_at     INTEGER NOT NULL
      );
      CREATE INDEX idx_events_session ON events(session_id, created_at);

      -- Things that must survive a mutation, captured either side of the cut.
      -- 'norm' is the canonical form (lowercased, whitespace-collapsed, paths
      -- absolutised) so survival is an exact match on a canonical string and
      -- never a fuzzy comparison.
      CREATE TABLE items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id    INTEGER NOT NULL REFERENCES events(id),
        phase       TEXT NOT NULL CHECK (phase IN ('pre','post')),
        kind        TEXT NOT NULL CHECK (kind IN ('constraint','artifact','commitment')),
        value       TEXT NOT NULL,
        norm        TEXT NOT NULL,
        hash        TEXT NOT NULL,
        source_ref  TEXT
      );
      CREATE INDEX idx_items_event ON items(event_id, phase, kind);
      CREATE INDEX idx_items_hash  ON items(event_id, hash);

      CREATE TABLE detections (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id   INTEGER NOT NULL REFERENCES events(id),
        detector   TEXT NOT NULL,
        severity   TEXT NOT NULL CHECK (severity IN ('info','warn','critical')),
        item_id    INTEGER REFERENCES items(id),
        detail     TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_detections_event ON detections(event_id, detector);

      CREATE TABLE violations (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id            INTEGER REFERENCES events(id),
        constraint_item_id  INTEGER REFERENCES items(id),
        session_id          TEXT NOT NULL,
        interception_point  TEXT NOT NULL,
        tool_name           TEXT,
        tool_input          TEXT,
        verdict             TEXT NOT NULL,
        ts                  INTEGER NOT NULL
      );
      CREATE INDEX idx_violations_session ON violations(session_id, ts);

      -- Every interception, for replay and for the report's denominator.
      CREATE TABLE interceptions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT NOT NULL,
        point       TEXT NOT NULL,
        adapter     TEXT NOT NULL,
        tool_name   TEXT,
        decision    TEXT NOT NULL,
        elapsed_ms  REAL NOT NULL,
        ts          INTEGER NOT NULL
      );
      CREATE INDEX idx_interceptions_session ON interceptions(session_id, ts);
    `,
  },
]
