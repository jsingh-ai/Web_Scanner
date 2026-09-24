// SQLite connection, schema, and migrations.
//
// One better-sqlite3 handle per process (the dashboard reads; the scan worker
// writes). WAL mode lets those coexist safely. Schema changes are applied through
// the ordered `MIGRATIONS` list using PRAGMA user_version, so the file self-upgrades
// on open and every environment converges to the same schema.
//
// See docs/ARCHITECTURE.md §5 (data model) and docs/BUILD-RULES.md rule 14 (WAL).

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const DEFAULT_DB_PATH = join(REPO_ROOT, 'data', 'scanner.db');

/** ISO-8601 UTC timestamp with millisecond precision, matching the SQLite defaults. */
export function nowIso() {
  return new Date().toISOString();
}

// Ordered schema migrations. Never edit a released migration in place — append a new
// one. `user_version` records the highest applied index.
const MIGRATIONS = [
  // v1 — initial schema
  `
  CREATE TABLE apps (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT    NOT NULL,
    url               TEXT    NOT NULL,
    enabled           INTEGER NOT NULL DEFAULT 1,
    is_rich_dashboard INTEGER NOT NULL DEFAULT 0,
    sections_json     TEXT,
    wait_strategy     TEXT    NOT NULL DEFAULT 'load',
    wait_selector     TEXT,
    settle_ms         INTEGER NOT NULL DEFAULT 3000,
    timeout_ms        INTEGER NOT NULL DEFAULT 30000,
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at        TEXT
  );

  CREATE TABLE scan_batches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger     TEXT    NOT NULL,               -- schedule | manual | catchup
    started_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    finished_at TEXT
  );

  CREATE TABLE checks (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id          INTEGER NOT NULL REFERENCES scan_batches(id) ON DELETE CASCADE,
    app_id            INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    status            TEXT    NOT NULL,          -- good | warning | down | error
    confidence        REAL,
    method            TEXT    NOT NULL,          -- reachability | deterministic | vision
    http_status       INTEGER,
    load_ms           INTEGER,
    summary           TEXT,
    verdict_json      TEXT,                      -- full sections/machines breakdown
    screenshot_path   TEXT,
    screenshot_pruned INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE INDEX idx_checks_app_created ON checks(app_id, created_at DESC, id DESC);
  CREATE INDEX idx_checks_batch       ON checks(batch_id);

  CREATE TABLE machine_notes (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    check_id INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
    section  TEXT,
    machine  TEXT,
    state    TEXT,
    note     TEXT
  );

  CREATE INDEX idx_machine_notes_check ON machine_notes(check_id);
  `,
  // v2 — optional free-text description per app
  `ALTER TABLE apps ADD COLUMN description TEXT;`,
];

let db = null;

/** Open (once) and return the shared database handle, applying migrations. */
export function getDb() {
  if (db) return db;

  const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
  mkdirSync(dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  migrate(db);
  return db;
}

function migrate(handle) {
  const current = handle.pragma('user_version', { simple: true });
  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version];
    handle.transaction(() => {
      handle.exec(sql);
      // user_version must be a literal; the index is code-controlled, not user input.
      handle.pragma(`user_version = ${version + 1}`);
    })();
  }
}

/** Close the handle (used by tests and on graceful shutdown). */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
