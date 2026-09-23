// Scan worker entry point — the short-lived process. Launched by the scheduler and by
// the dashboard's "Run now" button (Phases 6-7); both pass a trigger. It acquires the
// single-flight lock, runs one scan, prints a summary, then EXITS so all browser
// memory is reclaimed (docs/BUILD-RULES.md rules 2 & 4).
//
// Usage: node src/scan.js [schedule|manual|catchup]

import 'dotenv/config';

import { acquireLock, releaseLock } from './scan/lock.js';
import { runScan } from './scan/runner.js';

const VALID_TRIGGERS = new Set(['schedule', 'manual', 'catchup']);
const trigger = VALID_TRIGGERS.has(process.argv[2]) ? process.argv[2] : 'manual';

const lock = acquireLock();
if (!lock.acquired) {
  console.error(`scan already running (lock held since ${lock.since}); skipping this run.`);
  process.exit(0); // not an error — single-flight means we intentionally skip
}

try {
  const summary = await runScan(trigger);
  console.log(`scan complete: ${JSON.stringify(summary)}`);
} catch (e) {
  console.error('scan failed:', e);
  process.exitCode = 1;
} finally {
  releaseLock();
}
