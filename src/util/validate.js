// Input validation shared by the data layer and (later) the settings API.
//
// NOTE: this file does FORMAT validation only. The SSRF network-range guard required
// by docs/BUILD-RULES.md rule 16 (block loopback/link-local/metadata/private ranges,
// prefer an internal allowlist) is a security concern implemented in Phase 6, and
// `assertSafeUrl` is the hook it will extend. Until then, only protocol/shape are
// enforced.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

const WAIT_STRATEGIES = new Set(['load', 'domcontentloaded', 'networkidle']);

/**
 * Normalize and validate a URL string. Adds https:// when no scheme is given.
 * Throws ValidationError for anything that isn't a well-formed http(s) URL.
 */
export function normalizeUrl(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new ValidationError('url is required');
  }
  let raw = input.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
    raw = `https://${raw}`;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError(`url is not valid: ${input}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('url must use http or https');
  }
  return url.toString();
}

/**
 * Placeholder for the Phase 6 SSRF guard. Today it only re-checks the protocol via
 * normalizeUrl; Phase 6 will add host-range blocking and the allowlist. Callers
 * should route every user-supplied URL through here so the hardening lands in one place.
 */
export function assertSafeUrl(input) {
  return normalizeUrl(input);
}

export function requireName(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new ValidationError('name is required');
  }
  const name = input.trim();
  if (name.length > 200) {
    throw new ValidationError('name must be 200 characters or fewer');
  }
  return name;
}

/** Coerce a value to a bounded integer, or throw. Used for settle_ms / timeout_ms. */
export function requireInt(value, field, { min, max, fallback }) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new ValidationError(`${field} must be an integer`);
  }
  if (n < min || n > max) {
    throw new ValidationError(`${field} must be between ${min} and ${max}`);
  }
  return n;
}

export function normalizeWaitStrategy(value, fallback = 'load') {
  if (value === undefined || value === null || value === '') return fallback;
  if (!WAIT_STRATEGIES.has(value)) {
    throw new ValidationError(
      `wait_strategy must be one of: ${[...WAIT_STRATEGIES].join(', ')}`,
    );
  }
  return value;
}
