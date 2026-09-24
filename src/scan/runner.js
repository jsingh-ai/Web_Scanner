// Scan orchestration. Each app is scanned as its MAIN view (its own URL) plus every
// enabled TAB view — a separate URL, or a tab reached by clicking within the app.
// Each produces its own check (main = view_id NULL). One Chromium for the whole
// batch, a fresh context per check closed in `finally`, bounded concurrency, an
// overall wall-clock cap, and screenshot pruning at the end.
// See docs/ARCHITECTURE.md §1, §4 and docs/BUILD-RULES.md.

import { chromium } from 'playwright';

import { listApps } from '../db/apps.js';
import { listViews } from '../db/views.js';
import { finishBatch, recordCheck, startBatch } from '../db/results.js';
import { judgeScreenshot } from '../ai/provider.js';
import { saveScreenshot } from '../storage/screenshots.js';
import { pruneOldScreenshots } from '../storage/prune.js';
import { captureApp } from './capture.js';
import { classify } from './checks.js';
import { checkReachability, classifyReachability } from './reachability.js';

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_WALL_CLOCK_MS = 10 * 60 * 1000;

/**
 * Run the ladder for one target (an app's main view, or a tab view).
 * @param {object} context - Playwright browser context
 * @param {object} app - the app config (url, timeouts, is_rich_dashboard)
 * @param {object} [opts] - { clickTarget } for a click-navigated tab
 */
export async function checkOneApp(context, app, opts = {}) {
  const started = Date.now();

  // Reachability pre-check (skipped implicitly for click tabs since app.url is the
  // reachable main page).
  const reach = await checkReachability(app.url, Math.min(app.timeout_ms ?? 30000, 15000));
  const reachVerdict = classifyReachability(reach);
  if (reachVerdict) {
    return {
      status: reachVerdict.status,
      method: reachVerdict.method,
      http_status: reach.status ?? null,
      load_ms: Date.now() - started,
      summary: reachVerdict.reason,
      confidence: null,
      sections: [],
      machines: [],
      screenshotBuffer: null,
    };
  }

  const signals = await captureApp(context, app, opts);

  const det = classify(signals, app);
  if (!det.escalate) {
    return {
      status: det.status,
      method: det.method,
      http_status: signals.httpStatus,
      load_ms: signals.loadMs,
      summary: det.reason,
      confidence: null,
      sections: [],
      machines: [],
      screenshotBuffer: signals.screenshotBuffer,
    };
  }

  const v = await judgeScreenshot({ screenshotBuffer: signals.screenshotBuffer, app, signals });
  return {
    status: v.status,
    method: v.method,
    provider: v.provider,
    http_status: signals.httpStatus,
    load_ms: signals.loadMs,
    summary: v.summary,
    confidence: v.confidence,
    sections: v.sections,
    machines: v.machines,
    screenshotBuffer: signals.screenshotBuffer,
  };
}

/** Scan one target and record it. `view` is null for the main view. */
async function runTarget(browser, batchId, app, view, summary) {
  const context = await browser.newContext();
  try {
    let result;
    if (!view) {
      result = await checkOneApp(context, app);
    } else if (view.nav_type === 'click') {
      result = await checkOneApp(context, app, { clickTarget: view.target });
    } else {
      result = await checkOneApp(context, { ...app, url: view.target });
    }

    let screenshotPath = null;
    if (result.screenshotBuffer && result.screenshotBuffer.length) {
      try {
        screenshotPath = saveScreenshot(result.screenshotBuffer, { appId: app.id });
      } catch {
        /* keep the verdict even if the screenshot save fails */
      }
    }

    recordCheck(
      batchId,
      app.id,
      {
        status: result.status,
        confidence: result.confidence ?? null,
        method: result.method,
        http_status: result.http_status ?? null,
        load_ms: result.load_ms ?? null,
        summary: result.summary ?? null,
        sections: result.sections ?? [],
        machines: result.machines ?? [],
        screenshot_path: screenshotPath,
      },
      view ? view.id : null,
    );
    summary.checked++;
    summary.byStatus[result.status] = (summary.byStatus[result.status] || 0) + 1;
  } catch (e) {
    recordCheck(
      batchId,
      app.id,
      {
        status: 'error',
        method: 'deterministic',
        summary: `scan error: ${(e && e.message) || e}`,
        sections: [],
        machines: [],
        screenshot_path: null,
      },
      view ? view.id : null,
    );
    summary.checked++;
    summary.byStatus.error = (summary.byStatus.error || 0) + 1;
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Run a full scan of all enabled apps and their enabled tab views.
 * @param {'schedule'|'manual'|'catchup'} trigger
 */
export async function runScan(trigger = 'manual', opts = {}) {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const wallClockMs = opts.wallClockMs ?? DEFAULT_WALL_CLOCK_MS;
  const retentionDays = Number(process.env.SCREENSHOT_RETENTION_DAYS ?? 14);

  // Flatten to one task per view (main + enabled tabs).
  const tasks = [];
  for (const app of listApps({ onlyEnabled: true })) {
    tasks.push({ app, view: null });
    for (const view of listViews(app.id, { onlyEnabled: true })) tasks.push({ app, view });
  }

  const batchId = startBatch(trigger);
  const deadline = Date.now() + wallClockMs;
  const summary = { batchId, trigger, total: tasks.length, checked: 0, skipped: 0, byStatus: {} };

  const browser = await chromium.launch();
  try {
    let index = 0;
    const worker = async () => {
      while (true) {
        const i = index++;
        if (i >= tasks.length) break;
        if (Date.now() > deadline) {
          summary.skipped++;
          continue;
        }
        await runTarget(browser, batchId, tasks[i].app, tasks[i].view, summary);
      }
    };
    const poolSize = Math.min(concurrency, Math.max(tasks.length, 1));
    await Promise.all(Array.from({ length: poolSize }, () => worker()));
  } finally {
    await browser.close().catch(() => {});
    finishBatch(batchId);
  }

  try {
    summary.pruned = pruneOldScreenshots(retentionDays);
  } catch {
    summary.pruned = 0;
  }
  return summary;
}
