// CI smoke for tab views + discovery candidates (DB level, no browser). Exits
// non-zero on failure.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function assert(cond, msg) {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

const work = mkdtempSync(join(tmpdir(), 'ws-views-'));
process.env.DB_PATH = join(work, 'scanner.db');

try {
  const { getDb, closeDb } = await import('../src/db/db.js');
  const apps = await import('../src/db/apps.js');
  const views = await import('../src/db/views.js');
  const results = await import('../src/db/results.js');

  getDb();
  const a = apps.createApp({ name: 'App', url: 'http://10.0.0.9/' });

  // --- candidates ---
  views.replaceCandidates(a.id, [
    { label: 'Reports', nav_type: 'url', target: 'http://10.0.0.9/reports' },
    { label: 'Historian', nav_type: 'url', target: 'http://10.0.0.9/hist' },
  ]);
  assert(views.listCandidates(a.id).length === 2, 'candidates stored');
  views.replaceCandidates(a.id, [{ label: 'Reports', nav_type: 'url', target: 'http://10.0.0.9/reports' }]);
  assert(views.listCandidates(a.id).length === 1, 'candidates replaced (not appended)');
  views.clearCandidates(a.id);
  assert(views.listCandidates(a.id).length === 0, 'candidates cleared');

  // --- create views ---
  const v1 = views.createView(a.id, { label: 'Reports', nav_type: 'url', target: 'http://10.0.0.9/reports' });
  const v2 = views.createView(a.id, { label: 'Panel', nav_type: 'click', target: 'Panel' });
  assert(views.listViews(a.id).length === 2, 'two views');

  // --- enable/disable ---
  views.updateView(v2.id, { enabled: false });
  assert(views.listViews(a.id, { onlyEnabled: true }).length === 1, 'one enabled view');

  // --- per-view check ---
  const batch = results.startBatch('manual');
  results.recordCheck(batch, a.id, { status: 'down', method: 'reachability', sections: [], machines: [] }, v1.id);
  results.finishBatch(batch);
  const vc = results.getLatestCheckForView(v1.id);
  assert(vc && vc.status === 'down' && vc.view_id === v1.id, 'per-view check recorded');

  // --- status surfaces enabled views + their checks ---
  const st = results.getLatestStatuses();
  assert(st[0].views.length === 1, 'status shows only enabled views');
  assert(st[0].views[0].view.id === v1.id, 'enabled view is v1');
  assert(st[0].views[0].check.status === 'down', 'view check surfaced in status');

  // --- soft delete preserves history ---
  assert(views.deleteView(v1.id) === true, 'soft delete reported');
  assert(views.listViews(a.id).length === 1, 'deleted view hidden from list');
  assert(results.getLatestCheckForView(v1.id).status === 'down', 'view history preserved after delete');

  closeDb();
  console.log('VIEWS SMOKE PASSED');
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}
