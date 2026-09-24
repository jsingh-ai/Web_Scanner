// Shared prompt construction, JSON extraction, and verdict normalization for the
// vision judges. Provider-agnostic so Anthropic and OpenAI return the identical
// canonical Verdict shape (docs/ARCHITECTURE.md §4).

const STATUSES = new Set(['good', 'warning', 'down']);

/** System prompt: the judging rules, including the standby-is-normal rule. */
export function buildSystemPrompt() {
  return [
    'You judge whether an internal web application is healthy from a screenshot of',
    'its page plus a few automated signals.',
    '',
    'PRIMARY signal is application health: did the page render real content, is data',
    'present and fresh, are there error screens, blank panels, or broken layouts.',
    '',
    'IMPORTANT: industrial dashboards often show individual machine tiles that are',
    "grey / idle / 'standby' / 'offline'. Idle or standby machines are NORMAL and do",
    'NOT make the application unhealthy. Judge the APPLICATION first; report per-machine',
    'states only as informational detail.',
    '',
    'Return ONLY a JSON object (no prose, no markdown, no code fences) with this shape:',
    '{',
    '  "status": "good" | "warning" | "down",',
    '  "confidence": number from 0 to 1,',
    '  "summary": "one concise sentence",',
    '  "sections": [ { "name": string, "status": "good"|"warning"|"down", "notes": string } ],',
    '  "machines": [ { "section": string, "id": string, "state": string, "note": string } ]',
    '}',
    '',
    'status: good = app is up and showing data; warning = app loads but something looks',
    'off or you are unsure; down = app is broken, blank, erroring, or showing no data.',
    'For a rich dashboard, identify the visible sections yourself from the screenshot',
    '(use their on-screen headings) and report each one in the sections array.',
    'For a simple (non-dashboard) page, return empty sections and machines arrays.',
    'Only list machines worth noting (offline/error/standby); do not list healthy ones.',
  ].join('\n');
}

/** Per-request user text: app context + configured sections + deterministic signals. */
export function buildUserText(app = {}, signals = {}) {
  const kind = app.is_rich_dashboard ? 'a rich industrial dashboard' : 'a web application';
  const sectionsLine =
    app.sections && app.sections.length ? `Configured sections: ${app.sections.join(', ')}.` : '';
  const sig = [
    signals.httpStatus != null ? `HTTP ${signals.httpStatus}` : null,
    signals.loadMs != null ? `loaded in ${signals.loadMs}ms` : null,
    signals.textLength != null ? `${signals.textLength} chars of visible text` : null,
    signals.consoleErrors && signals.consoleErrors.length
      ? `${signals.consoleErrors.length} console errors`
      : null,
  ]
    .filter(Boolean)
    .join('; ');

  return [
    `Application: ${app.name || 'unknown'} (${app.url || ''}). This is ${kind}.`,
    app.description ? `Context: ${app.description}` : '',
    sectionsLine,
    sig ? `Automated signals: ${sig}.` : '',
    'Judge the application health from the attached screenshot. Respond with JSON only.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Extract a JSON object from a model text response. Tolerant of code fences and
 * surrounding prose. Returns the parsed object or null.
 */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  try {
    return JSON.parse(t.slice(first, last + 1));
  } catch {
    return null;
  }
}

function clampStr(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** Coerce an arbitrary parsed object into the canonical Verdict shape. */
export function normalizeVerdict(raw) {
  const status = STATUSES.has(raw && raw.status) ? raw.status : 'warning';

  let confidence = Number(raw && raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) confidence = null;

  const sections = Array.isArray(raw && raw.sections)
    ? raw.sections.slice(0, 50).map((s) => ({
        name: clampStr(s && s.name, 120),
        status: STATUSES.has(s && s.status) ? s.status : 'good',
        notes: clampStr(s && s.notes, 500),
      }))
    : [];

  const machines = Array.isArray(raw && raw.machines)
    ? raw.machines.slice(0, 200).map((m) => ({
        section: clampStr(m && m.section, 120),
        id: clampStr((m && (m.id || m.machine)) || '', 120),
        state: clampStr(m && m.state, 60),
        note: clampStr(m && m.note, 300),
      }))
    : [];

  return { status, confidence, summary: clampStr(raw && raw.summary, 500), sections, machines };
}
