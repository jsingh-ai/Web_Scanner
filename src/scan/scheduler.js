// In-process scheduler: fires a scan at the configured morning/evening times and, on
// startup, runs a catch-up scan if the most recent due slot was missed (e.g. the VM
// was off/rebooting at 7am). This is what makes reboots safe without an OS scheduler
// (docs/DECISIONS.md §2). All times are the server's local time, same as the cron
// expressions. Scans run in a fresh worker process via spawnScan.

import cron from 'node-cron';
import { getLatestBatch } from '../db/results.js';
import { spawnScan } from './spawnScan.js';

const MORNING_CRON = process.env.MORNING_CRON || '0 7 * * *';
const EVENING_CRON = process.env.EVENING_CRON || '0 19 * * *';

/** Parse a numeric hour out of a simple cron expression, else null. */
function cronHour(expr) {
  const h = String(expr).trim().split(/\s+/)[1];
  return /^\d+$/.test(h) ? Number(h) : null;
}

function slotHours() {
  const hours = [cronHour(MORNING_CRON), cronHour(EVENING_CRON)].filter((h) => h != null);
  return hours.length ? hours : [7, 19];
}

/** The most recent scheduled slot (a Date) that has already passed as of `now` (ms). */
export function mostRecentSlot(now, hours = [7, 19]) {
  const sorted = [...hours].sort((a, b) => a - b);
  const d = new Date(now);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sorted[i], 0, 0, 0);
    if (slot.getTime() <= now) return slot;
  }
  // Before today's first slot → yesterday's last slot.
  const y = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sorted[sorted.length - 1], 0, 0, 0);
  y.setDate(y.getDate() - 1);
  return y;
}

/** True if no batch has run since the most recent due slot (so we should catch up). */
export function dueCatchup(now, lastBatchIso, hours = [7, 19]) {
  if (!lastBatchIso) return true;
  const slot = mostRecentSlot(now, hours);
  return new Date(lastBatchIso).getTime() < slot.getTime();
}

/**
 * Register the cron jobs and run a startup catch-up if needed.
 * @param {object} [opts] - { spawn } injectable for tests
 * @returns {import('node-cron').ScheduledTask[]} the scheduled tasks (call .stop() to cancel)
 */
export function startScheduler({ spawn = spawnScan } = {}) {
  const tasks = [];
  for (const [expr, name] of [[MORNING_CRON, 'morning'], [EVENING_CRON, 'evening']]) {
    if (!cron.validate(expr)) {
      console.warn(`[scheduler] invalid cron for ${name}: ${expr}`);
      continue;
    }
    tasks.push(cron.schedule(expr, () => spawn('schedule')));
    console.log(`[scheduler] ${name} scan scheduled: ${expr}`);
  }

  try {
    const last = getLatestBatch();
    if (dueCatchup(Date.now(), last ? last.started_at : null, slotHours())) {
      console.log('[scheduler] running catch-up scan on startup (missed slot)');
      spawn('catchup');
    }
  } catch (e) {
    console.warn('[scheduler] catch-up check failed:', (e && e.message) || e);
  }

  return tasks;
}
