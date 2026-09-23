// SSRF guard for user-supplied URLs (docs/BUILD-RULES.md rule 16).
//
// IMPORTANT nuance for THIS app: the monitored apps live on the internal network, so
// PRIVATE LAN ranges (10/8, 172.16/12, 192.168/16, IPv6 ULA) are ALLOWED — blocking
// them would break the tool. We block only the addresses that are never a legitimate
// monitoring target and are the real SSRF risks: loopback, link-local (incl. the
// 169.254.169.254 cloud-metadata endpoint), and the unspecified address. An optional
// SCAN_URL_ALLOWLIST (comma-separated host suffixes) narrows it further.
//
// Enforced in the HTTP API layer (the only untrusted entry point) on add AND edit;
// the DB layer keeps doing sync format validation via normalizeUrl.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { normalizeUrl, ValidationError } from '../util/validate.js';

/** True if an IP literal is in a blocked (never-a-target) range. */
export function isBlockedIp(ip) {
  if (isIP(ip) === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 127) return true; // loopback 127.0.0.0/8
    if (p[0] === 0) return true; // unspecified 0.0.0.0/8
    if (p[0] === 169 && p[1] === 254) return true; // link-local + metadata 169.254.0.0/16
    return false; // private LAN ranges are intentionally allowed
  }
  const low = ip.toLowerCase();
  if (low === '::1' || low === '::') return true; // loopback / unspecified
  if (low.startsWith('fe80')) return true; // link-local
  const mapped = low.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedIp(mapped[1]); // IPv4-mapped IPv6
  return false; // fc00::/7 ULA (private) and normal addresses allowed
}

function allowlist() {
  const raw = process.env.SCAN_URL_ALLOWLIST;
  if (!raw) return null;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Validate a URL for scanning: format + protocol (via normalizeUrl), optional
 * allowlist, and SSRF range checks against resolved addresses. Returns the normalized
 * URL, or throws ValidationError (statusCode 400).
 */
export async function assertUrlAllowed(input) {
  const url = normalizeUrl(input);
  const host = new URL(url).hostname.toLowerCase();

  const allow = allowlist();
  if (allow && !allow.some((s) => host === s || host.endsWith(`.${s}`))) {
    throw new ValidationError(`host not in allowlist: ${host}`);
  }

  if (host === 'localhost') {
    throw new ValidationError('localhost is not allowed');
  }

  if (isIP(host)) {
    if (isBlockedIp(host)) throw new ValidationError(`blocked address: ${host}`);
    return url;
  }

  // Resolve the hostname and reject if ANY resolved address is blocked.
  let addrs;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    // Transient DNS failure isn't an SSRF signal — allow it; the scan will just fail
    // its own reachability check later.
    return url;
  }
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new ValidationError(`host ${host} resolves to a blocked address (${a.address})`);
    }
  }
  return url;
}
