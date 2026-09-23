// CI smoke test — proves the two riskiest dependencies work on the target platform
// BEFORE any application logic exists:
//   1. better-sqlite3 loads its prebuilt native binary and runs a query.
//   2. Playwright Chromium launches and renders.
// Exits non-zero on any failure so the GitHub Actions job fails loudly.

import Database from 'better-sqlite3';
import { chromium } from 'playwright';

// --- 1. better-sqlite3 (native module) ---
const db = new Database(':memory:');
db.exec('CREATE TABLE t (id INTEGER NOT NULL)');
db.prepare('INSERT INTO t (id) VALUES (?)').run(1);
const { n } = db.prepare('SELECT COUNT(*) AS n FROM t').get();
db.close();
if (n !== 1) {
  throw new Error(`sqlite smoke failed: expected 1 row, got ${n}`);
}
console.log('OK  better-sqlite3: query returned', n);

// --- 2. Playwright Chromium ---
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<h1>ok</h1>');
  const text = await page.textContent('h1');
  if (text !== 'ok') {
    throw new Error(`playwright smoke failed: expected "ok", got "${text}"`);
  }
  console.log('OK  playwright chromium: rendered and read back "ok"');
} finally {
  await browser.close();
}

console.log(`SMOKE PASSED on ${process.platform} / Node ${process.version}`);
