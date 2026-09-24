// CI smoke test for the data layer. Runs the whole apps + results flow against a
// throwaway SQLite file and asserts the results. Proves migrations, CRUD, the
// scan-result write path, soft-delete-preserves-history, and URL normalization all
// work on the CI platform. Exits non-zero on any failure.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'ws-db-'));
process.env.DB_PATH = join(dir, 'smoke.db');

function assert(cond, msg) {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

try {
  const { getDb, closeDb } = await import('../src/db/db.js');
  const apps = await import('../src/db/apps.js');
  const results = await import('../src/db/results.js');

  getDb(); // triggers migrations

  // --- create + normalization ---
  const app = apps.createApp({
    name: '  Test App  ',
    url: 'example.com',
    description: 'Line 3 press timers',
    is_rich_dashboard: true,
    sections: ['Pinch', 'Lamination'],
  });
  assert(app.id > 0, 'app id assigned');
  assert(app.name === 'Test App', 'name trimmed');
  assert(app.url === 'https://example.com/', 'url normalized to https');
  assert(app.description === 'Line 3 press timers', 'description stored');
  assert(app.is_rich_dashboard === true, 'boolean mapped');
  assert(app.sections.length === 2, 'sections parsed');
  assert(app.wait_strategy === 'load', 'default wait strategy is load');

  // --- list + get ---
  assert(apps.listApps().length === 1, 'list returns one');
  assert(apps.getApp(app.id).name === 'Test App', 'get by id');

  // --- update ---
  const updated = apps.updateApp(app.id, { name: 'Renamed', settle_ms: 5000, enabled: false });
  assert(updated.name === 'Renamed', 'name updated');
  assert(updated.settle_ms === 5000, 'settle_ms updated');
  assert(updated.enabled === false, 'enabled toggled');

  // --- record a scan ---
  const batchId = results.startBatch('manual');
  const checkId = results.recordCheck(batchId, app.id, {
    status: 'good',
    confidence: 0.92,
    method: 'vision',
    http_status: 200,
    load_ms: 1234,
    summary: 'Dashboard healthy; some machines idle',
    sections: [{ name: 'Pinch', status: 'good' }],
    machines: [{ section: 'Lamination', machine: 'Laminator #6', state: 'offline', note: 'no data' }],
    screenshot_path: 'data/screenshots/2026-09-23/1.webp',
  });
  results.finishBatch(batchId);
  assert(checkId > 0, 'check recorded');

  // --- latest status ---
  const latest = results.getLatestStatuses();
  assert(latest.length === 1, 'one latest status');
  assert(latest[0].check.status === 'good', 'latest status is good');
  assert(latest[0].check.verdict.machines.length === 1, 'verdict machines round-trip');

  // --- history ---
  assert(results.getAppHistory(app.id).length === 1, 'history has one check');

  // --- prunable query ---
  assert(results.getPrunableScreenshots(14).length === 0, 'nothing prunable yet (fresh)');

  // --- soft delete preserves history ---
  assert(apps.deleteApp(app.id) === true, 'soft delete reported');
  assert(apps.listApps().length === 0, 'deleted app hidden from list');
  assert(results.getAppHistory(app.id).length === 1, 'history preserved after delete');

  // --- validation rejects bad input ---
  let threw = false;
  try {
    apps.createApp({ name: 'Bad', url: 'ftp://nope' });
  } catch {
    threw = true;
  }
  assert(threw, 'non-http url rejected');

  closeDb();
  console.log('DB SMOKE PASSED');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
