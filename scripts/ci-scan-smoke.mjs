// CI smoke test for the scan engine. Exercises the deterministic classifier and
// reachability logic as pure functions, then runs a real Playwright capture against a
// data: URL and saves the screenshot. Exits non-zero on any failure.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

import { classify, scanErrorSignatures } from '../src/scan/checks.js';
import { classifyReachability } from '../src/scan/reachability.js';
import { captureApp } from '../src/scan/capture.js';
import { saveScreenshot } from '../src/storage/screenshots.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

// --- 1. Deterministic classifier (pure) ---
assert(
  classify({ httpStatus: 200, textLength: 500, domNodeCount: 200 }, { is_rich_dashboard: false })
    .status === 'good',
  'healthy simple page -> good',
);
assert(classify({ httpStatus: 500 }, {}).status === 'down', 'HTTP 500 -> down');
assert(classify({ httpStatus: 404 }, {}).status === 'down', 'HTTP 404 -> down');
assert(classify({ navError: 'net::ERR_TIMED_OUT' }, {}).status === 'down', 'nav error -> down');
assert(
  classify({ httpStatus: 200, textLength: 0, domNodeCount: 2 }, {}).status === 'down',
  'blank page -> down',
);
assert(
  classify({ httpStatus: 200, textLength: 500, domNodeCount: 200, selectorMissing: true }, {})
    .status === 'down',
  'missing readiness selector -> down',
);
assert(
  classify(
    { httpStatus: 200, textLength: 500, domNodeCount: 200, errorKeywordsFound: ['internal server error'] },
    {},
  ).status === 'down',
  'error signature -> down',
);
assert(
  classify({ httpStatus: 200, textLength: 500, domNodeCount: 200 }, { is_rich_dashboard: true })
    .escalate === true,
  'rich dashboard -> escalate to vision',
);
assert(scanErrorSignatures('Oops: Internal Server Error occurred').length === 1, 'signature scan');

// --- 2. Reachability classifier (pure) ---
assert(
  classifyReachability({ reachable: false, error: 'ECONNREFUSED' }).status === 'down',
  'unreachable -> down',
);
assert(
  classifyReachability({ reachable: true, status: 503 }).status === 'down',
  '5xx -> down',
);
assert(classifyReachability({ reachable: true, status: 200 }) === null, '200 -> proceed');
assert(classifyReachability({ reachable: true, status: 403 }) === null, '4xx -> proceed to browser');

// --- 3. Real capture against a data: URL, then save the screenshot ---
const ssDir = mkdtempSync(join(tmpdir(), 'ws-ss-'));
process.env.SCREENSHOT_DIR = ssDir;

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const app = {
    url:
      'data:text/html,<h1>Dashboard OK</h1><p>Pinch Lamination Totani live data updating 123 456 789</p>',
    wait_strategy: 'load',
    wait_selector: null,
    settle_ms: 0,
    timeout_ms: 15000,
  };
  const signals = await captureApp(context, app);
  assert(signals.textLength > 0, 'capture returned visible text');
  assert(signals.domNodeCount > 0, 'capture counted DOM nodes');
  assert(signals.screenshotBuffer && signals.screenshotBuffer.length > 0, 'capture took a screenshot');
  assert(signals.navError === null, 'no navigation error on a good page');

  const verdict = classify(signals, { is_rich_dashboard: false });
  assert(verdict.status === 'good', 'captured good page classifies as good');

  const relPath = saveScreenshot(signals.screenshotBuffer, { appId: 1 });
  assert(relPath.startsWith('data/screenshots/'), 'screenshot path is repo-relative');
  const absSaved = join(ssDir, relPath.split('/').slice(2).join('/'));
  assert(existsSync(absSaved), 'screenshot file written to disk');

  await context.close();
  console.log('SCAN SMOKE PASSED');
} finally {
  await browser.close();
  rmSync(ssDir, { recursive: true, force: true });
}
