// Scan orchestration: run every enabled app through the ladder
//   reachability -> capture -> deterministic classify -> (escalate) vision
// then record the verdict and screenshot. One Chromium for the whole batch, a fresh
// context per app closed in `finally`, bounded concurrency, and an overall wall-clock
// cap so a batch can never run away. Screenshots older than the retention window are
// pruned at the end. See docs/ARCHITECTURE.md §1, §4 and docs/BUILD-RULES.md.

import { chromium } from 'playwright';

import { listApps } from '../db/apps.js';
import { finishBatch, recordCheck, startBatch } from '../db/results.js';
import { judgeScreenshot } from '../ai/provider.js';
import { saveScreenshot } from '../storage/screenshots.js';
import { pruneOldScreenshots } from '../storage/prune.js';
import { captureApp } from './capture.js';
import { classify } from './checks.js';
import { checkReachability, classifyReachability } from './reachability.js';

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_WALL_CLOCK_MS = 10 * 60 * 1000; // 10 minutes for a whole batch

/**
 * Run the ladder for one app using an existing browser context. Returns a result
 * object shaped for recordCheck (plus a screenshotBuffer to persist).
 */
export async function checkOneApp(context, app) {
  const started = Date.now();

  // 1. Reachability — no browser needed for a hard-down app.
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

  // 2. Capture in the browser.
  const signals = await captureApp(context, app);

  // 3. Deterministic classification (cheap; no AI).
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

  // 4. Vision escalation (rich dashboards / ambiguous). Always resolves.
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

/**
 * Run a full scan of all enabled apps.
 * @param {'schedule'|'manual'|'catchup'} trigger
 * @param {object} [opts] - { concurrency, wallClockMs }
 * @returns {Promise<object>} summary
 */
export async function runScan(trigger = 'manual', opts = {}) {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const wallClockMs = opts.wallClockMs ?? DEFAULT_WALL_CLOCK_MS;
  const retentionDays = Number(process.env.SCREENSHOT_RETENTION_DAYS ?? 14);

  const apps = listApps({ onlyEnabled: true });
  const batchId = startBatch(trigger);
  const deadline = Date.now() + wallClockMs;
  const summary = { batchId, trigger, total: apps.length, checked: 0, skipped: 0, byStatus: {} };

  const browser = await chromium.launch();
  try {
    let index = 0;
    const worker = async () => {
      while (true) {
        const i = index++;
        if (i >= apps.length) break;
        if (Date.now() > deadline) {
          summary.skipped++;
          continue;
        }
        const app = apps[i];
        const context = await browser.newContext();
        try {
          const result = await checkOneApp(context, app);

          let screenshotPath = null;
          if (result.screenshotBuffer && result.screenshotBuffer.length) {
            try {
              screenshotPath = saveScreenshot(result.screenshotBuffer, { appId: app.id });
            } catch {
              // A screenshot save failure must not drop the verdict.
            }
          }

          recordCheck(batchId, app.id, {
            status: result.status,
            confidence: result.confidence ?? null,
            method: result.method,
            http_status: result.http_status ?? null,
            load_ms: result.load_ms ?? null,
            summary: result.summary ?? null,
            sections: result.sections ?? [],
            machines: result.machines ?? [],
            screenshot_path: screenshotPath,
          });
          summary.checked++;
          summary.byStatus[result.status] = (summary.byStatus[result.status] || 0) + 1;
        } catch (e) {
          recordCheck(batchId, app.id, {
            status: 'error',
            method: 'deterministic',
            summary: `scan error: ${(e && e.message) || e}`,
            sections: [],
            machines: [],
            screenshot_path: null,
          });
          summary.checked++;
          summary.byStatus.error = (summary.byStatus.error || 0) + 1;
        } finally {
          await context.close().catch(() => {});
        }
      }
    };

    const poolSize = Math.min(concurrency, Math.max(apps.length, 1));
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
