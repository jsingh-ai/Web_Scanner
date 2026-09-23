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

## Phase 4 — AI judgment

- [ ] Provider-agnostic `judge()` interface
- [ ] Anthropic implementation (structured outputs, pinned model)
- [ ] OpenAI implementation (json_schema)
- [ ] Escalation logic + runtime fallback + graceful "vision unavailable"

## Phase 5 — Orchestration

- [ ] Scan runner (`runner.js`): iterate apps, concurrency, verdict assembly
- [ ] Single-flight lock, kill-timeout, wall-clock cap
- [ ] Retention / pruning job

## Phase 6 — Dashboard + settings + security

- [ ] Status page (server-rendered + fetch), section/machine breakdown display
- [ ] ⚙ settings CRUD UI
- [ ] Output escaping, write-token + CSRF, SSRF URL guard, LAN bind, audit log
- [ ] Run-now button

## Phase 7 — Scheduling + deployment

- [ ] node-cron 07:00 / 19:00 + startup catch-up
- [ ] `scripts/install-service.ps1` (NSSM)
- [ ] Final deployment docs pass
