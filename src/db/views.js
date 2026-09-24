// Tab "views" for an app. The MAIN view is implicit (the app's own URL; its checks
// carry view_id NULL). This module manages the extra TAB views plus the discovery
// candidates the "Scan tabs" worker produces. Delete is soft (deleted_at) so a
// removed tab's history is preserved, consistent with app deletion.

import { getDb, nowIso } from './db.js';

function toView(row) {
  if (!row) return null;
  return {
    id: row.id,
    app_id: row.app_id,
    label: row.label,
    nav_type: row.nav_type,
    target: row.target,
    enabled: !!row.enabled,
    created_at: row.created_at,
    deleted_at: row.deleted_at,
  };
}

/** Tab views for an app (excludes soft-deleted). */
export function listViews(appId, { onlyEnabled = false } = {}) {
  const db = getDb();
  const where = ['app_id = ?', 'deleted_at IS NULL'];
  if (onlyEnabled) where.push('enabled = 1');
  return db
    .prepare(`SELECT * FROM views WHERE ${where.join(' AND ')} ORDER BY id ASC`)
    .all(appId)
    .map(toView);
}

export function getView(id) {
  const db = getDb();
  return toView(db.prepare('SELECT * FROM views WHERE id = ?').get(id));
}

/** Create a tab view. `input`: { label, nav_type, target }. */
export function createView(appId, input) {
  const db = getDb();
  const label = String(input.label || '').trim().slice(0, 200) || 'Tab';
  const nav_type = input.nav_type === 'click' ? 'click' : 'url';
  const target = String(input.target || '').trim();
  if (!target) throw new Error('view target is required');
  const info = db
    .prepare(
      'INSERT INTO views (app_id, label, nav_type, target) VALUES (?, ?, ?, ?)',
    )
    .run(appId, label, nav_type, target);
  return getView(info.lastInsertRowid);
}

export function updateView(id, patch) {
  const db = getDb();
  const existing = getView(id);
  if (!existing) return null;
  const fields = {};
  if (patch.label !== undefined) fields.label = String(patch.label).trim().slice(0, 200);
  if (patch.enabled !== undefined) fields.enabled = patch.enabled ? 1 : 0;
  if (patch.nav_type !== undefined) fields.nav_type = patch.nav_type === 'click' ? 'click' : 'url';
  if (patch.target !== undefined) fields.target = String(patch.target).trim();
  const keys = Object.keys(fields);
  if (!keys.length) return existing;
  fields.id = id;
  db.prepare(`UPDATE views SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run(fields);
  return getView(id);
}

/** Soft-delete a tab view (keeps its history). */
export function deleteView(id) {
  const db = getDb();
  const info = db
    .prepare('UPDATE views SET deleted_at = ?, enabled = 0 WHERE id = ? AND deleted_at IS NULL')
    .run(nowIso(), id);
  return info.changes > 0;
}

/* ---------- Discovery candidates ---------- */

/** Replace the candidate set for an app (called by the discovery worker). */
export function replaceCandidates(appId, candidates) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM view_candidates WHERE app_id = ?').run(appId);
    const ins = db.prepare(
      'INSERT INTO view_candidates (app_id, label, nav_type, target) VALUES (?, ?, ?, ?)',
    );
    for (const c of candidates) {
      ins.run(appId, String(c.label || '').slice(0, 200), c.nav_type === 'click' ? 'click' : 'url', String(c.target || ''));
    }
  });
  tx();
}

export function listCandidates(appId) {
  const db = getDb();
  return db
    .prepare('SELECT id, label, nav_type, target, created_at FROM view_candidates WHERE app_id = ? ORDER BY id ASC')
    .all(appId);
}

export function clearCandidates(appId) {
  const db = getDb();
  db.prepare('DELETE FROM view_candidates WHERE app_id = ?').run(appId);
}
