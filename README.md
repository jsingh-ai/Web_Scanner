# Web Scanner — Internal App Status Monitor

A self-hosted tool that, on a schedule (~7am / 7pm), opens each of your internal
web applications in a real browser, waits for it to load, takes a screenshot, and
judges each app **good / warning / down**. Results are shown on a status page that
teammates can open over the internal network, with history kept over time.

Built for a Windows Server 2025 VM. No Docker. Runs on plain Node.js.

---

## What it does

- Opens ~20 configured app URLs in headless Chromium (Playwright).
- Runs **cheap deterministic checks first** (reachable? HTTP ok? blank page? error
  text?) and only escalates to a **vision model** when needed — e.g. for rich
  SCADA/industrial dashboards where it also produces a per-section breakdown
  (Pinch / Lamination / Totani / …). Idle/standby machines are treated as
  **normal**, not failures — app health is the primary signal.
- Prefers **Anthropic Claude**, automatically falls back to **OpenAI** if only that
  key is present. Verdicts come back as structured JSON either way.
- Stores verdicts in **SQLite** (kept long-term) and screenshots on disk
  (**pruned after 14 days**).
- Serves a **status page + ⚙ settings UI** (add / edit / delete apps, no login) on
  the internal network, plus a **Run now** button.

## Architecture at a glance

Two processes, decoupled on purpose:

- **`monitor-web`** — an always-on Fastify service (status page, JSON API, settings,
  screenshots). Never launches a browser. Supervised by **NSSM** as a Windows
  service (auto-start on boot, auto-restart on crash).
- **`scan.js`** — a short-lived worker spawned per scan. Launches Chromium, checks
  every app, writes results, then **exits** so browser memory is fully reclaimed.
  Triggered by an in-process scheduler (7am/7pm + startup catch-up) and by the
  **Run now** button — same code path, guarded by a single-flight lock.

Full design and the reasoning behind every choice:

- [docs/VISION.md](docs/VISION.md) — what we're building and why (the product north-star).
- [docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md) — what's built, the codebase map, deploy state, open questions.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the design (current + target platform).
- [docs/DECISIONS.md](docs/DECISIONS.md) — why we chose each option (the trade-offs).
- [docs/BUILD-RULES.md](docs/BUILD-RULES.md) — the rules all code must follow.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — how to deploy on the VM.
- [docs/ROADMAP.md](docs/ROADMAP.md) — the phased build plan (monitor + platform).

**Evaluating this project?** Start with [PROJECT-STATUS.md](docs/PROJECT-STATUS.md)
(what's built + open questions), then [VISION.md](docs/VISION.md), then
[ROADMAP.md](docs/ROADMAP.md) and [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quickstart (once code lands in later phases)

```bash
npm install
npx playwright install chromium
cp .env.example .env   # then fill in an API key
node src/server.js     # dashboard on http://localhost:8080
node src/scan.js       # run a scan by hand
```

> **Status:** Phase 1 (structure + docs + CI) — no runtime code yet. See the
> [roadmap](docs/ROADMAP.md).

## Requirements

- Node.js **22.16.x** (matches the deploy VM; the CI runner is pinned to it too).
- Windows Server 2025 for production; the code is cross-platform for development.
- Outbound HTTPS to `api.anthropic.com` and/or `api.openai.com`.
