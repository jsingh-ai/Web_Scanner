# Architecture

This is the locked design. Every decision here was stress-tested by three
independent architecture proposals and an expert evaluation; the reasoning is in
[DECISIONS.md](DECISIONS.md). Rules that code must obey are in
[BUILD-RULES.md](BUILD-RULES.md).

---

## 1. Process / runtime model

**Two decoupled processes**, chosen for their opposite lifecycles:

| | `monitor-web` (dashboard) | `scan.js` (scan worker) |
|---|---|---|
| Lifetime | Always-on, long-lived | Runs per scan, then **exits** |
| Weight | Light (~80–150 MB) | Heavy (Chromium) |
| Browser | **Never** launches one | Launches one Chromium |
| Supervised by | NSSM (Windows service) | Spawned as a child process |

**Why:** Playwright/Chromium accumulates memory over long-lived sessions
(unclosed contexts, renderer growth, orphan `chrome.exe` on Windows). Making the
browser's lifetime equal to a single scan means the OS reclaims **100%** of that
memory the instant the worker exits. The always-on dashboard therefore never
inherits browser bloat, and a hung/crashed scan can't take down the status page.

Within one scan, the browser is treated as long-lived per Playwright guidance:
one `browser`, a fresh `context` + `page` per app closed in a `finally` block,
2–4 apps concurrent. The parent enforces a **hard kill-timeout** on the child plus
an overall **wall-clock cap** so a hung page can never wedge a scan forever.

## 2. Tech stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 22.16.x (already on the VM) |
| Web server / API | Fastify + `@fastify/static` |
| Browser automation | Playwright (Chromium only, headless) |
| Storage (verdicts) | better-sqlite3 (WAL mode), single file |
| Storage (screenshots) | WebP files on disk, downscaled (~1280px), path referenced in DB |
| Scheduler | in-process `node-cron` + startup catch-up + single-flight lock |
| Keep-alive / service | NSSM (WinSW acceptable alternative — **not** node-windows) |
| Frontend | static HTML + vanilla ES-module JS + CSS, served locally, **no build step, no CDN** |
| AI verdicts | provider-agnostic `judge()`; Claude first, OpenAI fallback |

## 3. Page-load wait strategy

**`networkidle` is banned as a default.** SCADA/OPC dashboards poll continuously
over XHR/WebSocket and may never reach network-idle, which would hang the scan or
produce false "down" verdicts on exactly the industrial apps that matter most.

Standard sequence per app:

1. `page.goto(url, { waitUntil: 'load' })`
2. a bounded settle delay (`settle_ms`, per-app configurable)
3. optional `waitForSelector(wait_selector)` when the app exposes a readiness element

A per-app `networkidle` override may exist but is used sparingly, never as the default.

## 4. Judgment pipeline (hybrid, cheap-first)

Per app, stop as soon as a confident verdict is reached:

1. **Reachability pre-check** — a lightweight GET (HEAD with GET fallback). Connection
   refused / DNS failure / 5xx → `down` **without launching a browser**.
2. **Load in Chromium** — the wait strategy above; capture main-response HTTP status,
   console/page errors.
3. **Deterministic signals** — HTTP ≥ 400; error-keyword / error-signature scan of
   visible text (`500`, `cannot connect`, stack traces, framework error overlays);
   **blank / near-uniform screenshot detection** via pixel variance; minimal
   DOM/visible-text length. Clear pass or clear fail → verdict now, no AI.
4. **Vision escalation — only when needed** — triggered when the deterministic result
   is ambiguous/`warning`, or the app is flagged `is_rich_dashboard`. The screenshot
   is sent to the AI provider with a prompt that states explicitly: **grey / idle /
   "standby" tiles are NORMAL**; app-health (page rendered, data fresh, no error or
   blank panels) is the **primary** signal; the per-section / per-machine breakdown
   is **secondary and informational**. Sections configured per app are listed in the
   prompt.

### Provider / model

A single interface: `judge(screenshot, context) -> Verdict`.

- Selection: `ANTHROPIC_API_KEY` present → Anthropic; else `OPENAI_API_KEY` → OpenAI;
  else deterministic-only mode.
- **Runtime fallback:** if the primary provider errors or times out, retry on the
  other. If **both** fail, emit `warning: "vision unavailable"` — **never a false
  `down`**.
- Structured JSON output on both providers (Anthropic structured outputs /
  OpenAI `json_schema`). Default model is a current vision-capable Claude model, set
  via one env var, with a cheaper Claude model as a documented override (see
  DECISIONS.md §4). Cost is a few dollars/month at ~40 escalations/day.

**Verdict schema:**

```jsonc
{
  "status": "good | warning | down",
  "confidence": 0.0,
  "summary": "one-line human summary",
  "sections": [ { "name": "Pinch", "status": "good", "notes": "..." } ],
  "machines": [ { "section": "Lamination", "id": "Laminator #6", "state": "offline", "note": "..." } ]
}
```

## 5. Data model (SQLite, WAL)

```
apps(
  id, name, url, enabled,
  is_rich_dashboard, sections_json,
  wait_strategy, wait_selector, settle_ms, timeout_ms,
  created_at, updated_at
)

scan_batches(
  id, trigger,            -- schedule | manual | catchup
  started_at, finished_at
)

checks(
  id, batch_id, app_id,
  status, confidence,
  method,                 -- reachability | deterministic | vision
  http_status, load_ms,
  summary, verdict_json,  -- full sections/machines breakdown
  screenshot_path, screenshot_pruned,
  created_at
)

-- optional, for querying the SCADA breakdown:
machine_notes(check_id, section, machine, state, note)
```

## 6. Scheduling & keep-alive

- **Schedule** lives in the always-on service: `node-cron` at `0 7 * * *` and
  `0 19 * * *`. On service start, a **catch-up check** asks "is there a completed
  batch for today's due slot?" and, if not, fires one immediately — covering runs
  missed while the VM was off.
- **Run now** (`POST /api/run-now`) uses the same `spawnScan()` path, guarded by a
  **single-flight lock** so a manual run can't overlap a scheduled one.
- **Keep-alive:** NSSM installs `monitor-web` as an auto-start Windows service that
  restarts on crash and runs with no user logged in.

## 7. Retention

- **Verdicts:** kept indefinitely (a few KB of text each).
- **Screenshots:** WebP, pruned nightly at **>14 days** (file deleted, row kept with
  `screenshot_pruned = 1`). Periodic WAL checkpoint / `VACUUM`.
- Budget: ~20 apps × 2/day × 14 days ≈ 560 files, comfortably < 1 GB of the ~27 GB free.

## 8. Security (no-login settings UI on the network)

The settings UI has no login by design, and the server fetches whatever URL a user
enters — so these mitigations are **mandatory**, not optional:

- **SSRF guard** on every new/edited URL: block loopback, link-local, cloud-metadata
  (`169.254.169.254`), and private ranges by default; prefer an allowlist of expected
  internal hosts.
- **Stored-XSS prevention:** strictly escape every user-supplied string (app name,
  URL) on output to the status page.
- **Write-token** on all settings mutations (POST/PUT/DELETE) + CSRF protection
  (SameSite) so a drive-by internal page can't add/delete apps.
- **Network scoping:** bind to the internal interface + a Windows Firewall rule
  limiting access to the team subnet. Screenshots may show sensitive dashboards, so
  keep this scope tight.
- **Audit log:** source IP + timestamp on every settings edit.

## 9. CI (the only test path)

The user cannot build locally. GitHub Actions is the gate before pulling to the VM:
a Windows runner pinned to Node 22.16.x runs `npm install` (or `npm ci` once a
lockfile is committed) + `npx playwright install chromium` + a smoke step that opens
a SQLite DB and launches Chromium. Green check → safe to pull. See
[.github/workflows/ci.yml](../.github/workflows/ci.yml).

---

# Target platform architecture (Phases 12+)

The single-tenant monitor above becomes a multi-tenant **registry + governance
platform**. This section sketches the target so it can be evaluated before building.
See [VISION.md](VISION.md), [ROADMAP.md](ROADMAP.md), [DECISIONS.md](DECISIONS.md).

## Data model (additive)

```
companies(id, name, sort_order, created_at)
categories(id, company_id, name, color, sort_order, created_at)
apps(... existing ..., category_id NULL)          -- site → category → company

users(id, name, email, password_hash, is_superuser, created_at)
memberships(id, user_id, company_id, role)         -- role: viewer|contributor|reviewer|admin
sessions(id, user_id, expires_at, ...)             -- server-side sessions

-- Ownership + workflow (Phases 14-15)
apps(... owner_user_id NULL, contact_email NULL, lifecycle_state)
   -- lifecycle_state: draft|submitted|reviewing|approved|live|rejected|retired
submissions(id, app_id, submitted_by, reviewer_user_id, state, created_at, decided_at, note)
audit_log(id, actor_user_id, action, entity, entity_id, detail, at)

-- Notifications (Phase 16)
notifications(id, user_id, kind, payload, read_at, created_at)
notification_channels(company_id/user_id, type[teams|email], config)   -- webhook url / address
```

The **main view stays implicit** (checks with `view_id NULL`); tabs and scanning are
unchanged — RBAC and workflow are layers on top of the existing scan/verdict data.

## RBAC enforcement

- Every **read** (status, history, screenshots, API) is filtered by the caller's
  company memberships: a user sees a company only if they have a role in it; the
  superuser sees all. Enforce this in a single **authorization layer** in `server.js`
  (a `preHandler` that resolves the session → allowed company ids → scopes queries),
  not scattered per-route, to avoid leaks.
- **Writes** are gated by role: contributor (own sites), reviewer (approve),
  admin (manage company), superuser (all). The current `write-token` is replaced by
  session + role checks (Phase 13a).
- Screenshots are access-controlled too (a served screenshot must belong to a site the
  caller may see) — today they're static-served openly; this becomes an
  authorization-checked route.

## Auth + transport

- Local accounts: argon2/bcrypt password hashes, server-side sessions (HttpOnly,
  Secure, SameSite cookies), brute-force lockout.
- **Self-signed HTTPS** generated on-box (no CA/IT dependency) so cookies can be
  `Secure` and passwords aren't sent in cleartext. Swap in a real cert later if
  available. The NSSM service serves HTTPS (or an HTTP→HTTPS redirect).

## Workers unchanged

The scan and discovery workers, scheduler, and browser-free server model all carry
over. Scanning remains **once per shared site** regardless of how many users/companies
view it — RBAC changes who *sees* results, not how often we scan.

## Datastore

SQLite (better-sqlite3) continues to back this through the governance phases; the move
to PostgreSQL is triggered by multi-instance/HA or external hosting. Keep `db/` as a
thin data-access layer so the swap stays contained. Full analysis:
[PROJECT-STATUS.md](PROJECT-STATUS.md) → SQLite vs PostgreSQL.

## Open risks to weigh (for the evaluation)

- **Auth is a new, security-critical surface** — local auth done wrong is worse than
  the current no-login LAN model. Consider AD/SSO seriously.
- **RBAC leaks** are easy to introduce — centralize enforcement; test it hard.
- **Scope/timeline** — this is 5+ phases; keep deploying the working monitor meanwhile.
- **Screenshot authorization + retention** as history/tenancy grow.
- **Node/DB drift** and the pending `better-sqlite3` bump.
