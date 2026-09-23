// CI smoke for the scheduler. Tests the pure slot / catch-up logic and that
// startScheduler registers cron jobs and fires a startup catch-up when a slot was
// missed — using an injected mock spawn (no real scan, no browser). Exits non-zero on
// failure.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function assert(cond, msg) {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

const work = mkdtempSync(join(tmpdir(), 'ws-sched-'));
process.env.DB_PATH = join(work, 'scanner.db');

const { mostRecentSlot, dueCatchup, startScheduler } = await import('../src/scan/scheduler.js');
const { getDb, closeDb } = await import('../src/db/db.js');
const results = await import('../src/db/results.js');

// --- mostRecentSlot (local time) ---
// 2026-01-15 08:00 local -> most recent slot is 07:00 today.
const at8 = new Date(2026, 0, 15, 8, 0, 0).getTime();
assert(mostRecentSlot(at8, [7, 19]).getHours() === 7, 'slot at 08:00 is 07:00');
// 2026-01-15 06:00 local -> most recent slot is yesterday 19:00.
const at6 = new Date(2026, 0, 15, 6, 0, 0);
const slot6 = mostRecentSlot(at6.getTime(), [7, 19]);
assert(slot6.getHours() === 19 && slot6.getDate() === 14, 'slot at 06:00 is prior 19:00');
// 2026-01-15 20:00 local -> most recent slot is 19:00 today.
const at20 = new Date(2026, 0, 15, 20, 0, 0).getTime();
assert(mostRecentSlot(at20, [7, 19]).getHours() === 19, 'slot at 20:00 is 19:00');

// --- dueCatchup ---
assert(dueCatchup(at8, null) === true, 'no prior batch -> catch up');
assert(
  dueCatchup(at8, new Date(2026, 0, 15, 7, 30, 0).toISOString()) === false,
  'batch after the slot -> no catch up',
);
assert(
  dueCatchup(at8, new Date(2026, 0, 15, 6, 0, 0).toISOString()) === true,
  'batch before the slot -> catch up',
);

// --- startScheduler with an injected mock spawn ---
getDb(); // fresh DB, no batches -> startup catch-up should fire
const calls = [];
let tasks = startScheduler({ spawn: (t) => calls.push(t) });
assert(tasks.length === 2, 'two cron jobs registered (morning + evening)');
assert(calls.includes('catchup'), 'startup catch-up fired on empty DB');
tasks.forEach((t) => t.stop());

// Now record a recent batch -> no catch-up on next start.
results.startBatch('manual');
results.finishBatch(1);
calls.length = 0;
tasks = startScheduler({ spawn: (t) => calls.push(t) });
assert(!calls.includes('catchup'), 'recent batch -> no catch-up');
tasks.forEach((t) => t.stop());

closeDb();
try {
  rmSync(work, { recursive: true, force: true });
} catch {
  /* best-effort */
}
console.log('SCHEDULER SMOKE PASSED');
process.exit(0); // node-cron keeps background timers; exit explicitly
