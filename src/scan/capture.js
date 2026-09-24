// Playwright capture: load one app in a page and gather the raw signals that
// checks.js / the vision judge use. Never decides a verdict itself.
//
// Wait strategy is load -> settle -> optional readiness selector. `networkidle` is
// only used when an app explicitly opts in, never by default — SCADA/OPC dashboards
// poll forever and would hang it (docs/BUILD-RULES.md rule 5, docs/DECISIONS.md §5).

function waitUntilFor(strategy) {
  if (strategy === 'networkidle') return 'networkidle';
  if (strategy === 'domcontentloaded') return 'domcontentloaded';
  return 'load';
}

// Adaptive "settle": after load, wait until the page stops visibly changing (DOM node
// count + visible-text length stable across two checks) or a cap is hit. Rich
// dashboards get a longer cap since they stream data; simple pages finish in ~1s.
// Replaces fixed settle timers so no per-app tuning is needed.
async function smartSettle(page, app) {
  const cap = app.is_rich_dashboard ? 12000 : 6000;
  const start = Date.now();
  await page.waitForTimeout(400); // small base for first paint
  let last = null;
  let stable = 0;
  while (Date.now() - start < cap) {
    let metric;
    try {
      metric = await page.evaluate(
        () =>
          `${document.body ? document.body.innerText.length : 0}|${document.getElementsByTagName('*').length}`,
      );
    } catch {
      break;
    }
    if (metric === last) {
      if (++stable >= 2) break;
    } else {
      stable = 0;
      last = metric;
    }
    await page.waitForTimeout(500);
  }
}

/**
 * Capture signals for one app using an existing browser context.
 * @param {import('playwright').BrowserContext} context
 * @param {object} app - url, wait_strategy, wait_selector, settle_ms, timeout_ms
 * @param {object} [opts] - { screenshot = true }
 * @returns {Promise<object>} raw signals (see fields below)
 */
export async function captureApp(context, app, { screenshot = true } = {}) {
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const started = Date.now();
  let httpStatus = null;
  let navError = null;
  let finalUrl = null;
  let selectorMissing = false;

  try {
    const resp = await page.goto(app.url, {
      waitUntil: waitUntilFor(app.wait_strategy),
      timeout: app.timeout_ms ?? 30000,
    });
    httpStatus = resp ? resp.status() : null;
    finalUrl = page.url();

    await smartSettle(page, app);
    if (app.wait_selector) {
      try {
        await page.waitForSelector(app.wait_selector, { timeout: app.timeout_ms ?? 30000 });
      } catch {
        selectorMissing = true;
      }
    }
  } catch (e) {
    navError = (e && e.message) || String(e);
  }

  const loadMs = Date.now() - started;

  // Visible text + DOM size, used for blank-page and error-signature detection.
  let visibleText = '';
  let textLength = 0;
  let domNodeCount = 0;
  try {
    const info = await page.evaluate(() => ({
      text: document.body ? document.body.innerText : '',
      nodes: document.getElementsByTagName('*').length,
    }));
    visibleText = (info.text || '').slice(0, 20000);
    textLength = visibleText.trim().length;
    domNodeCount = info.nodes || 0;
  } catch {
    // evaluate can fail if the page never rendered; leave the zeros — that's a signal.
  }

  let screenshotBuffer = null;
  if (screenshot) {
    try {
      screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: true });
    } catch {
      // A screenshot failure shouldn't sink the whole check; the other signals stand.
    }
  }

  await page.close();

  return {
    httpStatus,
    navError,
    finalUrl,
    selectorMissing,
    loadMs,
    visibleText,
    textLength,
    domNodeCount,
    consoleErrors,
    pageErrors,
    screenshotBuffer,
  };
}
