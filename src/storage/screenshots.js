// Save scan screenshots to disk under data/screenshots/YYYY-MM-DD/, returning a
// repo-relative, forward-slash path suitable for storing in the DB and serving later.
//
// Format is JPEG (quality 72) as emitted natively by Playwright — no image-processing
// dependency is pulled in. See docs/DECISIONS.md §6 note on JPEG vs WebP. Pruning of
// files older than the retention window is a separate concern (Phase 5).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');

function screenshotRoot() {
  // Resolved at call time so tests can redirect via SCREENSHOT_DIR.
  return process.env.SCREENSHOT_DIR || join(REPO_ROOT, 'data', 'screenshots');
}

/**
 * Write a screenshot buffer and return its repo-relative path (forward slashes).
 * @param {Buffer} buffer
 * @param {object} opts - { appId, date = now, ext = 'jpg' }
 */
export function saveScreenshot(buffer, { appId, date = new Date(), ext = 'jpg' }) {
  const day = date.toISOString().slice(0, 10);
  const dir = join(screenshotRoot(), day);
  mkdirSync(dir, { recursive: true });

  const filename = `app-${appId}-${date.getTime()}.${ext}`;
  writeFileSync(join(dir, filename), buffer);

  return ['data', 'screenshots', day, filename].join('/');
}
