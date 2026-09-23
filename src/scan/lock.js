// Cross-process single-flight lock for scans. Because the scheduled scan and the
// "Run now" button both spawn `scan.js` as separate processes, the lock has to work
// across processes — an atomic O_EXCL lockfile does that. A lock older than STALE_MS
// (a crashed/killed scan that never released) is treated as stale and reclaimed.
// See docs/BUILD-RULES.md rule 4.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');

function lockPath() {
  return process.env.SCAN_LOCK_PATH || join(REPO_ROOT, 'data', 'scan.lock');
}

const STALE_MS = 30 * 60 * 1000; // 30 minutes

/** Try to acquire the lock. Returns { acquired, since? }. */
export function acquireLock() {
  const path = lockPath();
  mkdirSync(dirname(path), { recursive: true });

  if (existsSync(path)) {
    let ts = 0;
    try {
      ts = JSON.parse(readFileSync(path, 'utf8')).ts || 0;
    } catch {
      ts = 0;
    }
    if (ts && Date.now() - ts < STALE_MS) {
      return { acquired: false, since: new Date(ts).toISOString() };
    }
    // Stale or unreadable — reclaim it.
    try {
      unlinkSync(path);
    } catch {
      /* someone else may have just removed it */
    }
  }

  try {
    const fd = openSync(path, 'wx'); // atomic: fails if the file already exists
    writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
    closeSync(fd);
    return { acquired: true };
  } catch {
    return { acquired: false, since: 'unknown' };
  }
}

/** Release the lock (safe to call even if not held). */
export function releaseLock() {
  try {
    unlinkSync(lockPath());
  } catch {
    /* already gone */
  }
}
