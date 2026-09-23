# Roadmap

The build is phased. Each phase is its own branch + PR, checked by GitHub Actions
before being pulled to the VM. Check items off as phases merge.

---

## Phase 1 — Structure + docs + CI  ⬅ current

- [x] Folder skeleton (`src/ public/ scripts/ data/`)
- [x] README
- [x] ARCHITECTURE.md, DECISIONS.md, BUILD-RULES.md, DEPLOYMENT.md, ROADMAP.md
- [x] `package.json` with pinned deps
- [x] GitHub Actions CI (Windows runner: install + Chromium + SQLite/Chromium smoke)
- [x] `.gitignore`, `.env.example`

**Goal:** the structure and the rules exist, and CI proves the two riskiest
dependencies (better-sqlite3 native binary + Playwright Chromium) install cleanly on
Windows — before any logic is written.

## Phase 2 — Foundation (data layer)  ⬅ current

- [x] SQLite schema + migrations (`db.js`, WAL, `user_version` migrations)
- [x] App CRUD module (`apps.js`, soft-delete preserves history)
- [x] Results read/write module (`results.js`, batches/checks/machine_notes, latest + history)
- [x] Input validation + URL normalization (`util/validate.js`; SSRF guard hook for Phase 6)
- [x] Committed lockfile; CI switched to `npm ci`
- [x] Data-layer smoke test in CI (`scripts/ci-db-smoke.mjs`)

## Phase 3 — Scan engine  ⬅ current

- [x] Playwright capture (`scan/capture.js`): load + settle + optional selector; never `networkidle` by default
- [x] Reachability pre-check (`scan/reachability.js`): judged before launching a browser
- [x] Deterministic checks (`scan/checks.js`): HTTP, error signatures, blank-page, missing-selector
- [x] Screenshot save (`storage/screenshots.js`): JPEG q72, dated folders (WebP deferred — see DECISIONS §6)
- [x] Scan-engine CI smoke (`scripts/ci-scan-smoke.mjs`)

## Phase 4 — AI judgment  ⬅ current

- [x] Shared prompt + JSON extraction + verdict normalization (`ai/prompt.js`)
- [x] Anthropic implementation (`ai/anthropic.js`, default `claude-opus-5`, `VISION_MODEL` override)
- [x] OpenAI implementation (`ai/openai.js`, default `gpt-4o`, `OPENAI_VISION_MODEL` override, json_object mode)
- [x] Provider selection + runtime failover + graceful "vision unavailable" (`ai/provider.js`)
- [x] AI CI smoke (`scripts/ci-ai-smoke.mjs`) — pure logic + fallback paths, no API calls

## Phase 5 — Orchestration  ⬅ current

- [x] Scan runner (`scan/runner.js`): ladder per app, bounded concurrency, wall-clock cap, one browser per batch
- [x] Scan worker entry point (`src/scan.js`) — short-lived, exits after the run
- [x] Single-flight lock (`scan/lock.js`, atomic O_EXCL lockfile with stale reclaim)
- [x] Retention / pruning (`storage/prune.js`); screenshot paths made root-relative
- [x] End-to-end CI smoke (`scripts/ci-orchestration-smoke.mjs`) against a local server

## Phase 6 — Dashboard + settings + security  ⬅ current

- [x] Fastify dashboard service (`src/server.js`); serves status page, API, screenshots
- [x] Status page (`public/`) with status cards + expandable section/machine breakdown
- [x] ⚙ settings CRUD UI (add/edit/delete apps, write-token field)
- [x] Output escaping (all data via textContent), write-token + custom-header CSRF guard
- [x] SSRF URL guard (`security/ssrf.js`) — blocks loopback/link-local/metadata, allows private LAN
- [x] Audit-log hook (source IP + result on mutations); LAN bind via BIND_HOST
- [x] Run-now button → spawns the scan worker
- [x] Server CI smoke (`scripts/ci-server-smoke.mjs`) — API, auth, SSRF, static serving

## Phase 7 — Scheduling + deployment

- [ ] node-cron 07:00 / 19:00 + startup catch-up
- [ ] `scripts/install-service.ps1` (NSSM)
- [ ] Final deployment docs pass
