// Reachability pre-check — runs BEFORE launching a browser so hard-down apps
// (connection refused, DNS failure, 5xx) are judged cheaply. See
// docs/BUILD-RULES.md rule 7.

/**
 * Try to reach a URL with a short timeout. HEAD first, GET as a fallback for servers
 * that reject HEAD. A response (any status) means the host is up.
 */
export async function checkReachability(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let resp;
    try {
      resp = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    } catch {
      resp = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    }
    return { reachable: true, status: resp.status, error: null };
  } catch (e) {
    const error = e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || String(e);
    return { reachable: false, status: null, error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn a reachability result into a verdict, or null to proceed to the browser.
 * 4xx is intentionally NOT a hard-down here (many apps return 401/403/405 to HEAD but
 * render fine in a browser) — that judgment is left to the full capture + classify.
 */
export function classifyReachability(result) {
  if (!result.reachable) {
    return { status: 'down', method: 'reachability', reason: result.error || 'unreachable' };
  }
  if (typeof result.status === 'number' && result.status >= 500) {
    return { status: 'down', method: 'reachability', reason: `HTTP ${result.status}` };
  }
  return null;
}
