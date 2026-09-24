// Tab-discovery worker (short-lived, like the scan worker). Opens an app's main
// page, reads its navigation, and writes the found tabs as candidates for the user to
// pick from in Settings. Keeps the dashboard server browser-free (BUILD-RULES rule 1).
//
// Usage: node src/discover.js <appId>

import 'dotenv/config';

import { chromium } from 'playwright';
import { getApp } from './db/apps.js';
import { replaceCandidates } from './db/views.js';

const appId = Number(process.argv[2]);
if (!appId) {
  console.error('usage: node src/discover.js <appId>');
  process.exit(1);
}

const app = getApp(appId);
if (!app) {
  console.error(`app ${appId} not found`);
  process.exit(1);
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(app.url, { waitUntil: 'load', timeout: app.timeout_ms ?? 30000 });
  await page.waitForTimeout(1500);

  const raw = await page.evaluate(() => {
    const seen = new Set();
    const out = [];
    const add = (label, nav_type, target) => {
      label = (label || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!label || !target) return;
      const key = `${nav_type}|${target.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ label, nav_type, target });
    };
    // Look inside likely navigation containers first; fall back to the whole page.
    const scopes = Array.from(
      document.querySelectorAll(
        'nav, aside, header, [role=navigation], [role=tablist], [class*="sidebar" i], [class*="menu" i]',
      ),
    );
    const roots = scopes.length ? scopes : [document.body];
    for (const root of roots) {
      // Real links → URL tabs.
      root.querySelectorAll('a[href]').forEach((a) => {
        const href = a.href;
        const attr = a.getAttribute('href') || '';
        if (attr === '#' || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
        if (!/^https?:/i.test(href)) return;
        add(a.textContent, 'url', href);
      });
      // ARIA tabs → click tabs.
      root.querySelectorAll('[role=tab]').forEach((t) => add(t.textContent, 'click', (t.textContent || '').trim().slice(0, 60)));
    }
    return out.slice(0, 60);
  });

  // Drop the app's own URL (that's the implicit main view).
  const norm = (u) => u.replace(/\/+$/, '');
  const candidates = raw.filter((c) => !(c.nav_type === 'url' && norm(c.target) === norm(app.url)));

  replaceCandidates(appId, candidates);
  console.log(`discovered ${candidates.length} tab candidate(s) for app ${appId}`);
  await context.close();
} catch (e) {
  console.error('discovery failed:', (e && e.message) || e);
  try {
    replaceCandidates(appId, []); // signal completion with no results
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}
