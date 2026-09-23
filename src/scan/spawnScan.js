// Spawn the short-lived scan worker (src/scan.js) as a detached child. Shared by the
// dashboard's "Run now" button and the in-process scheduler, so both go through one
// path. The worker's own single-flight lock prevents overlapping runs.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCAN_ENTRY = join(HERE, '..', 'scan.js');

/** @param {'schedule'|'manual'|'catchup'} trigger */
export function spawnScan(trigger = 'manual') {
  const child = spawn(process.execPath, [SCAN_ENTRY, trigger], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child;
}
