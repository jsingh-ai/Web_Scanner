# scripts/

Operational and CI scripts.

- `ci-smoke.mjs` — CI smoke test: proves better-sqlite3 + Playwright Chromium work on
  the target platform. Run by GitHub Actions (`npm run ci:smoke`).
- `install-service.ps1` — (Phase 7) registers the dashboard as an NSSM Windows service.
