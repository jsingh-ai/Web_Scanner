// CI smoke for the orchestration layer. Exercises the single-flight lock, then runs a
// real end-to-end scan against a local HTTP server (reachability -> capture ->
// classify -> record), and finally the retention pruner. No external network, no AI
// keys (the test app is a simple page, so vision is never invoked). Exits non-zero on
// failure.

import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function assert(cond, msg) {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

// Isolate DB, screenshots, and lock into temp locations.
const work = mkdtempSync(join(tmpdir(), 'ws-orch-'));
process.env.DB_PATH = join(work, 'scanner.db');
process.env.SCREENSHOT_DIR = join(work, 'screenshots');
process.env.SCAN_LOCK_PATH = join(work, 'scan.lock');
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;

const lock = await import('../src/scan/lock.js');
const { getDb, closeDb } = await import('../src/db/db.js');
const apps = await import('../src/db/apps.js');
const results = await import('../src/db/results.js');
const { runScan } = await import('../src/scan/runner.js');
const { pruneOldScreenshots } = await import('../src/storage/prune.js');
const { resolveScreenshot } = await import('../src/storage/screenshots.js');

// --- 1. Single-flight lock ---
assert(lock.acquireLock().acquired === true, 'first acquire succeeds');
assert(lock.acquireLock().acquired === false, 'second acquire blocked');
lock.releaseLock();
assert(lock.acquireLock().acquired === true, 'acquire after release succeeds');
lock.releaseLock();

// --- 2. End-to-end scan against a local server ---
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<h1>Dashboard OK</h1><p>Pinch Lamination Totani live data 123 456 789 all good here</p>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/`;

getDb();
const app = apps.createApp({ name: 'Local Test', url, is_rich_dashboard: false, settle_ms: 0 });

const summary = await runScan('manual');
assert(summary.total === 1, 'one app scanned');
assert(summary.checked === 1, 'one check recorded');
assert(summary.byStatus.good === 1, `expected good, got ${JSON.stringify(summary.byStatus)}`);

const history = results.getAppHistory(app.id);
assert(history.length === 1, 'history has the check');
const check = history[0];
assert(check.status === 'good', 'recorded status good');
assert(check.method === 'deterministic', 'simple page judged deterministically (no AI)');
assert(check.screenshot_path && existsSync(resolveScreenshot(check.screenshot_path)), 'screenshot saved');

server.close();

// --- 3. Retention pruning ---
// Nothing is old enough yet.
assert(pruneOldScreenshots(14) === 0, 'fresh screenshot not pruned');

// Backdate the check 30 days and prune with a 14-day window.
const db = getDb();
const oldIso = new Date(Date.now() - 30 * 86400000).toISOString();
db.prepare('UPDATE checks SET created_at = ? WHERE id = ?').run(oldIso, check.id);

const savedPath = resolveScreenshot(check.screenshot_path);
assert(existsSync(savedPath), 'screenshot present before prune');
assert(pruneOldScreenshots(14) === 1, 'one old screenshot pruned');
assert(!existsSync(savedPath), 'screenshot file deleted');
assert(pruneOldScreenshots(14) === 0, 'nothing left to prune');

closeDb();
rmSync(work, { recursive: true, force: true });
console.log('ORCHESTRATION SMOKE PASSED');
