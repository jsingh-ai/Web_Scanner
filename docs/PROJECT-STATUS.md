# Project Status — what's built, what's where, what's open

_Snapshot for evaluation. Pairs with [VISION.md](VISION.md), [ROADMAP.md](ROADMAP.md),
[ARCHITECTURE.md](ARCHITECTURE.md), [DECISIONS.md](DECISIONS.md), [BUILD-RULES.md](BUILD-RULES.md)._

## Current state (what is BUILT)

A working, single-tenant **monitor** is complete and deployable. No auth yet
(LAN + write-token). Built across Phases 1–11:

- **Scheduled + on-demand scanning** of configured sites via Playwright (Chromium),
  desktop-viewport screenshots.
- **Hybrid judgment**: reachability → deterministic checks (HTTP, error text,
  blank-page) → **vision escalation** (Claude first, OpenAI fallback) for rich
  dashboards, returning a structured verdict with a section/machine breakdown.
- **Multi-tab (view) monitoring** per site, with AI-assisted **tab discovery**.
- **Dashboard**: responsive app-shell (collapsible sidebar, phone→ultrawide),
  light/dark, health gauge + stat row, status cards with screenshot thumbnails,
  zoomable screenshot viewer, search/filter, per-card edit, add-site drawer.
- **Data**: SQLite (better-sqlite3, WAL); verdicts kept indefinitely, screenshots
  pruned at 14 days.
- **Ops**: in-process scheduler (7am/7pm + startup catch-up), NSSM Windows service,
  CI smokes on a Windows runner.

## Codebase map (what's where)

```
src/
  server.js            Always-on Fastify dashboard: status page, JSON API,
                       screenshots, run-now, view/discovery endpoints. NEVER launches
                       a browser (spawns workers instead).
  scan.js              Short-lived scan worker entry (lock → runScan → exit).
  discover.js          Short-lived tab-discovery worker (reads an app's nav → candidates).
  scan/
    runner.js          Orchestrates a scan: main view + tab views, concurrency, caps.
    capture.js         Playwright capture: load + adaptive settle + optional click-nav;
                       desktop viewport; gathers signals + screenshot.
    checks.js          Deterministic classifier (cheap, no AI).
    reachability.js    Pre-flight fetch check (before launching a browser).
    lock.js            Cross-process single-flight lockfile.
    scheduler.js       In-process cron (7am/7pm) + startup catch-up.
    spawnScan.js       Spawns the scan / discovery workers.
  ai/
    provider.js        Claude-first / OpenAI-fallback selection + runtime failover.
    anthropic.js       Claude vision judge.
    openai.js          OpenAI vision judge.
    prompt.js          Shared prompt + JSON extraction + verdict normalization.
  db/
    db.js              better-sqlite3 connection + ordered migrations (user_version).
    apps.js            Site (app) CRUD.
    views.js           Tab-view CRUD + discovery candidates.
    results.js         Scan batches, per-check writes, latest status, history.
  storage/
    screenshots.js     Save/resolve screenshots (root-relative paths).
    prune.js           14-day screenshot retention.
  security/
    ssrf.js            SSRF guard on user URLs (allows private LAN, blocks loopback/
                       link-local/metadata).
  util/validate.js     Field validation + URL normalization.
public/                Static dashboard (index.html, styles.css, app.js). No build step.
scripts/               CI smokes (ci-*-smoke.mjs), install-service.ps1 (NSSM).
.github/workflows/     CI (Windows runner: install + Chromium + smokes).
docs/                  These docs.
```

## Deployment state (reality on the ground)

- Runs on a **Windows Server VM**. The VM has **Node 24** (project/CI target Node 22);
  `better-sqlite3` 11.8.0 crashes on Node 24, so on the VM the operator ran
  `npm install better-sqlite3@latest`. **A repo bump of better-sqlite3 (+ lockfile
  regen) is still pending** — until then a fresh clone / `npm ci` reintroduces the crash.
- Playwright browsers installed machine-wide at `PLAYWRIGHT_BROWSERS_PATH=C:\ms-playwright`
  so the NSSM service (LocalSystem) can find them.
- Corporate TLS proxy: npm/Playwright downloads may need the corporate root CA
  (`NODE_EXTRA_CA_CERTS` / npm `cafile`).
- Deployed via NSSM service `WebScannerWeb` on port 8080 (HTTP, LAN).
- Several phase PRs may be open/unmerged at any time — check GitHub.

## What we're building next (see ROADMAP for detail)

Evolving into the **registry + governance platform**: companies/categories +
navigation + history (Phase 12), then users + roles + RBAC over self-signed HTTPS
(13), ownership (14), intake/approval workflow (15), notifications (16).

## OPEN QUESTIONS for evaluation

1. **Datastore: stay on SQLite, or move to PostgreSQL?** See the analysis below —
   this is the biggest architectural fork as we go multi-tenant.
2. **Auth over self-signed HTTPS** vs pushing harder for AD/SSO. Local accounts were
   chosen for speed; is that the right call for an enterprise/sellable product?
3. **Build-vs-buy** was decided as "build," re-implementing commodity alerting/workflow.
   Worth a second, unbiased look given the maintenance cost.
4. **Screenshot storage** on local disk (pruned at 14 days) — fine single-node; does
   multi-tenant/history change the need (object storage, longer retention)?
5. **Scan scale**: shared catalog is scanned once, but as sites grow, is a 2×/day,
   3-concurrency single-VM scanner enough? When do we need a queue / multiple workers?
6. **Node version drift** (VM on 24, project on 22) — pick and pin one.

### SQLite vs PostgreSQL — analysis

**Current fit (SQLite / better-sqlite3):** excellent for a single-VM, low-write
workload. WAL gives many concurrent readers; writes (scans 2×/day, occasional edits)
are low-frequency so single-writer serialization is a non-issue. No DB server to run —
a real advantage on a locked-down, no-Docker Windows VM.

**What would push us to PostgreSQL:**
- **Multiple app instances / HA** (SQLite is a single-node file; you can't run two
  servers against it safely).
- **Hosting this for multiple external customers** (productizing) — a client-server DB
  with real backups, roles, and connection pooling becomes the right foundation.
- **High write concurrency** (frequent scans across many companies, many concurrent
  writers) — beyond our current profile.
- **Heavier relational/reporting queries** across large history.

**What Postgres costs us here:** a DB server to install, run, secure, and back up on
the VM (no Docker; corporate constraints) — real ops weight we currently avoid.

**Recommendation to evaluate:** SQLite is genuinely sufficient for the internal,
single-VM scale (a handful of companies, dozens of sites) through the governance
phases. The decisive trigger is **"are we hosting this for external customers / need
multiple instances?"** — if yes, move to Postgres before the multi-tenant data model
hardens; if it stays one-VM-per-site internal, SQLite is fine and simpler. Mitigation
either way: keep the `db/` modules as a thin data-access layer so a future swap is
contained, and avoid SQLite-only SQL where a portable form exists.
