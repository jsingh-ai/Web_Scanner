// Save and resolve scan screenshots.
//
// Files live under a screenshot ROOT (default data/screenshots, overridable via
// SCREENSHOT_DIR) in dated subfolders. The path stored in the DB is relative to that
// root (e.g. "2026-09-23/app-1-....jpg"), so both the web server and the pruner
// resolve it the same way regardless of where the root points. Format is JPEG q72 as
// emitted natively by Playwright — no image-processing dependency (DECISIONS §6).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');

/** The screenshot root directory. Resolved at call time so tests can redirect it. */
export function screenshotRoot() {
  return process.env.SCREENSHOT_DIR || join(REPO_ROOT, 'data', 'screenshots');
}

/**
 * Write a screenshot buffer and return its ROOT-RELATIVE path (forward slashes),
 * suitable for storing in the DB and serving/pruning later.
 * @param {Buffer} buffer
 * @param {object} opts - { appId, date = now, ext = 'jpg' }
 */
export function saveScreenshot(buffer, { appId, date = new Date(), ext = 'jpg' }) {
  const day = date.toISOString().slice(0, 10);
  mkdirSync(join(screenshotRoot(), day), { recursive: true });

  const filename = `app-${appId}-${date.getTime()}.${ext}`;
  writeFileSync(join(screenshotRoot(), day, filename), buffer);

  return `${day}/${filename}`;
}

/** Resolve a stored root-relative screenshot path to an absolute filesystem path. */
export function resolveScreenshot(relPath) {
  return join(screenshotRoot(), ...String(relPath).split('/'));
}
