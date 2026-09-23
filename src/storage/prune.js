// Screenshot retention: delete image files older than the retention window and flag
// their rows as pruned. Verdict rows themselves are kept forever (docs/ARCHITECTURE.md
// §7). Runs at the end of each scan; the window defaults to 14 days.

import { unlinkSync } from 'node:fs';
import { getPrunableScreenshots, markScreenshotPruned } from '../db/results.js';
import { resolveScreenshot } from './screenshots.js';

/** Delete screenshots older than `days`. Returns the number pruned. */
export function pruneOldScreenshots(days = 14) {
  if (!Number.isFinite(days) || days <= 0) return 0;
  const rows = getPrunableScreenshots(days);
  let pruned = 0;
  for (const row of rows) {
    try {
      unlinkSync(resolveScreenshot(row.screenshot_path));
    } catch {
      // File may already be gone; still flag the row so we stop revisiting it.
    }
    markScreenshotPruned(row.id);
    pruned++;
  }
  return pruned;
}
