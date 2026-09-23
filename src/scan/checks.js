// Deterministic ("cheap") verdict classification — the tier that runs before any AI
// call. Takes the raw signals gathered by capture.js and returns a confident verdict
// where possible, or { escalate: true } when only a vision model can judge.
//
// Pure function, no I/O — easy to unit-test. See docs/ARCHITECTURE.md §4 and
// docs/BUILD-RULES.md rules 8-9 (app-health primary; cheap checks before AI).

// A page is considered blank only when it has BOTH almost no visible text AND almost
// no DOM — conservative on purpose, so a lightly-populated real page isn't flagged.
const BLANK_TEXT_THRESHOLD = 10;
const BLANK_DOM_THRESHOLD = 10;

// Multi-word signatures, to avoid firing on an incidental "error" label in a dashboard.
const ERROR_SIGNATURES = [
  'internal server error',
  '500 internal',
  'service unavailable',
  'application error',
  'cannot connect',
  'could not connect',
  'database error',
  'connection refused',
  'fatal error',
  'stack trace',
  'traceback (most recent call last)',
];

/** Scan visible text for known error signatures. Returns the matches found. */
export function scanErrorSignatures(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return ERROR_SIGNATURES.filter((sig) => lower.includes(sig));
}

function verdict(status, reason) {
  return { status, method: 'deterministic', reason };
}

/**
 * Classify capture signals into a deterministic verdict, or escalate.
 * @param {object} signals - from captureApp(): httpStatus, navError, textLength,
 *   domNodeCount, errorKeywordsFound, selectorMissing, ...
 * @param {object} app - the app config (uses is_rich_dashboard).
 * @returns {{status,method,reason} | {escalate:true, method}}
 */
export function classify(signals, app = {}) {
  // 1. Navigation failed entirely (timeout, DNS, connection dropped mid-load).
  if (signals.navError) {
    return verdict('down', `navigation failed: ${signals.navError}`);
  }

  // 2. HTTP error status from the main response.
  const status = signals.httpStatus;
  if (typeof status === 'number' && status >= 400) {
    return verdict('down', `HTTP ${status}`);
  }

  // 3. Configured readiness element never appeared → app did not render.
  if (signals.selectorMissing) {
    return verdict('down', 'readiness element not found');
  }

  // 4. Error signatures in the visible text.
  const matches = signals.errorKeywordsFound || scanErrorSignatures(signals.visibleText);
  if (matches && matches.length) {
    return verdict('down', `error text: ${matches[0]}`);
  }

  // 5. Blank / empty page.
  if (
    (signals.textLength ?? 0) < BLANK_TEXT_THRESHOLD &&
    (signals.domNodeCount ?? 0) < BLANK_DOM_THRESHOLD
  ) {
    return verdict('down', 'page appears blank');
  }

  // 6. Page looks loaded. Rich dashboards still need vision to judge freshness and
  //    produce the section breakdown; simple pages are good deterministically.
  if (app.is_rich_dashboard) {
    return { escalate: true, method: 'deterministic' };
  }
  return verdict('good', 'page loaded with content');
}
