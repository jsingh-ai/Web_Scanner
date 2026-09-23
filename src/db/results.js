// Read/write scan results: batches, per-app checks, and the SCADA machine breakdown.
//
// A scan run is one `scan_batches` row; each app checked in it is one `checks` row,
// optionally with `machine_notes` for the informational per-machine breakdown.
// Verdicts are kept indefinitely; screenshots are pruned separately (Phase 5).

import { getDb, nowIso } from './db.js';
import { listApps } from './apps.js';

const VALID_TRIGGERS = new Set(['schedule', 'manual', 'catchup']);

/** Open a new scan batch and return its id. */
export function startBatch(trigger) {
  if (!VALID_TRIGGERS.has(trigger)) {
    throw new Error(`invalid batch trigger: ${trigger}`);
  }
  const db = getDb();
  return db.prepare('INSERT INTO scan_batches (trigger) VALUES (?)').run(trigger)
    .lastInsertRowid;
}

/** Mark a batch finished. */
export function finishBatch(batchId) {
  const db = getDb();
  db.prepare('UPDATE scan_batches SET finished_at = ? WHERE id = ?').run(nowIso(), batchId);
}

/**
 * Record one app's verdict within a batch. `verdict` fields:
 *   status, confidence, method, http_status, load_ms, summary,
 *   sections[], machines[], screenshot_path
 * The full sections/machines breakdown is stored as verdict_json; machines are also
 * flattened into machine_notes for querying. Returns the new check id.
 */
export function recordCheck(batchId, appId, verdict) {
  const db = getDb();
  const sections = verdict.sections || [];
  const machines = verdict.machines || [];
  const verdictJson = JSON.stringify({
    status: verdict.status,
    confidence: verdict.confidence ?? null,
    summary: verdict.summary ?? null,
    sections,
    machines,
  });

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO checks
           (batch_id, app_id, status, confidence, method, http_status,
            load_ms, summary, verdict_json, screenshot_path)
         VALUES
           (@batch_id, @app_id, @status, @confidence, @method, @http_status,
            @load_ms, @summary, @verdict_json, @screenshot_path)`,
      )
      .run({
        batch_id: batchId,
        app_id: appId,
        status: verdict.status,
        confidence: verdict.confidence ?? null,
        method: verdict.method,
        http_status: verdict.http_status ?? null,
        load_ms: verdict.load_ms ?? null,
        summary: verdict.summary ?? null,
        verdict_json: verdictJson,
        screenshot_path: verdict.screenshot_path ?? null,
      });
    const checkId = info.lastInsertRowid;

    if (machines.length) {
      const insertNote = db.prepare(
        `INSERT INTO machine_notes (check_id, section, machine, state, note)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const m of machines) {
        insertNote.run(checkId, m.section ?? null, m.machine ?? m.id ?? null, m.state ?? null, m.note ?? null);
      }
    }
    return checkId;
  });

  return tx();
}

/** Map a raw checks row to a typed object with the parsed verdict. */
function toCheck(row) {
  if (!row) return null;
  return {
    id: row.id,
    batch_id: row.batch_id,
    app_id: row.app_id,
    status: row.status,
    confidence: row.confidence,
    method: row.method,
    http_status: row.http_status,
    load_ms: row.load_ms,
    summary: row.summary,
    verdict: row.verdict_json ? JSON.parse(row.verdict_json) : null,
    screenshot_path: row.screenshot_path,
    screenshot_pruned: !!row.screenshot_pruned,
    created_at: row.created_at,
  };
}

/** The most recent check for an app, or null. */
export function getLatestCheck(appId) {
  const db = getDb();
  return toCheck(
    db
      .prepare(
        'SELECT * FROM checks WHERE app_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      )
      .get(appId),
  );
}

/** For every non-deleted app: the app plus its latest check (or null). */
export function getLatestStatuses() {
  return listApps().map((app) => ({ app, check: getLatestCheck(app.id) }));
}

/** Recent checks for one app, newest first. */
export function getAppHistory(appId, limit = 50) {
  const db = getDb();
  return db
    .prepare(
      'SELECT * FROM checks WHERE app_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    )
    .all(appId, limit)
    .map(toCheck);
}

export function getBatch(batchId) {
  const db = getDb();
  return db.prepare('SELECT * FROM scan_batches WHERE id = ?').get(batchId);
}

export function listBatches(limit = 50) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM scan_batches ORDER BY started_at DESC, id DESC LIMIT ?')
    .all(limit);
}

/**
 * Checks whose screenshot is older than `days` and not yet pruned. Used by the
 * Phase 5 retention job to delete the files and flag the rows.
 */
export function getPrunableScreenshots(days) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return db
    .prepare(
      `SELECT id, screenshot_path FROM checks
       WHERE screenshot_pruned = 0 AND screenshot_path IS NOT NULL AND created_at < ?`,
    )
    .all(cutoff);
}

/** Flag a check's screenshot as pruned (after the file is deleted). */
export function markScreenshotPruned(checkId) {
  const db = getDb();
  db.prepare('UPDATE checks SET screenshot_pruned = 1, screenshot_path = NULL WHERE id = ?').run(
    checkId,
  );
}
