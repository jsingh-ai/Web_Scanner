// CRUD for the monitored apps.
//
// `delete` is a SOFT delete (sets deleted_at) so a removed app's scan history is
// preserved — history retention is a core requirement (docs/ARCHITECTURE.md §7).
// Deleted apps are hidden from listApps() but their checks remain queryable.

import { getDb, nowIso } from './db.js';
import {
  assertSafeUrl,
  normalizeWaitStrategy,
  requireInt,
  requireName,
} from '../util/validate.js';

/** Map a raw DB row to a typed app object (booleans, parsed sections). */
function toApp(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: !!row.enabled,
    is_rich_dashboard: !!row.is_rich_dashboard,
    sections: row.sections_json ? JSON.parse(row.sections_json) : [],
    wait_strategy: row.wait_strategy,
    wait_selector: row.wait_selector,
    settle_ms: row.settle_ms,
    timeout_ms: row.timeout_ms,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

/** Validate and normalize caller input into column values. */
function normalizeInput(input, { partial = false } = {}) {
  const out = {};
  if (!partial || input.name !== undefined) out.name = requireName(input.name);
  if (!partial || input.url !== undefined) out.url = assertSafeUrl(input.url);
  if (!partial || input.enabled !== undefined) {
    out.enabled = input.enabled === undefined ? 1 : input.enabled ? 1 : 0;
  }
  if (!partial || input.is_rich_dashboard !== undefined) {
    out.is_rich_dashboard = input.is_rich_dashboard ? 1 : 0;
  }
  if (!partial || input.sections !== undefined) {
    out.sections_json =
      input.sections && input.sections.length ? JSON.stringify(input.sections) : null;
  }
  if (!partial || input.wait_strategy !== undefined) {
    out.wait_strategy = normalizeWaitStrategy(input.wait_strategy);
  }
  if (!partial || input.wait_selector !== undefined) {
    out.wait_selector = input.wait_selector ? String(input.wait_selector) : null;
  }
  if (!partial || input.settle_ms !== undefined) {
    out.settle_ms = requireInt(input.settle_ms, 'settle_ms', {
      min: 0,
      max: 120000,
      fallback: 3000,
    });
  }
  if (!partial || input.timeout_ms !== undefined) {
    out.timeout_ms = requireInt(input.timeout_ms, 'timeout_ms', {
      min: 1000,
      max: 300000,
      fallback: 30000,
    });
  }
  return out;
}

export function createApp(input) {
  const db = getDb();
  const v = normalizeInput(input, { partial: false });
  const info = db
    .prepare(
      `INSERT INTO apps
         (name, url, enabled, is_rich_dashboard, sections_json,
          wait_strategy, wait_selector, settle_ms, timeout_ms)
       VALUES
         (@name, @url, @enabled, @is_rich_dashboard, @sections_json,
          @wait_strategy, @wait_selector, @settle_ms, @timeout_ms)`,
    )
    .run(v);
  return getApp(info.lastInsertRowid);
}

export function getApp(id) {
  const db = getDb();
  return toApp(db.prepare('SELECT * FROM apps WHERE id = ?').get(id));
}

export function listApps({ includeDeleted = false, onlyEnabled = false } = {}) {
  const db = getDb();
  const where = [];
  if (!includeDeleted) where.push('deleted_at IS NULL');
  if (onlyEnabled) where.push('enabled = 1');
  const sql =
    'SELECT * FROM apps' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY name COLLATE NOCASE ASC, id ASC';
  return db.prepare(sql).all().map(toApp);
}

export function updateApp(id, patch) {
  const db = getDb();
  const existing = getApp(id);
  if (!existing) return null;
  const v = normalizeInput(patch, { partial: true });
  const keys = Object.keys(v);
  if (keys.length === 0) return existing;
  v.id = id;
  v.updated_at = nowIso();
  const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE apps SET ${setClause}, updated_at = @updated_at WHERE id = @id`).run(v);
  return getApp(id);
}

/** Soft delete: hides the app but keeps its history. Returns true if a row changed. */
export function deleteApp(id) {
  const db = getDb();
  const info = db
    .prepare('UPDATE apps SET deleted_at = ?, enabled = 0 WHERE id = ? AND deleted_at IS NULL')
    .run(nowIso(), id);
  return info.changes > 0;
}
