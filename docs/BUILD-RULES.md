# Build Rules

Non-negotiable rules that **all** code in every phase must follow. These encode the
architecture and its safety properties. A change that violates one of these is a bug,
even if it "works." If a rule genuinely needs to change, update
[DECISIONS.md](DECISIONS.md) first and say why.

---

## Process & lifecycle

1. **The dashboard process never launches a browser.** Playwright is imported and
   used only in `scan.js` and its modules — never in `server.js` or anything it loads
   at runtime.
2. **The scan worker must exit** after a batch completes (success or failure). No
   lingering event loop, no reused long-lived browser across scans.
3. Within a scan, **every `context`/`page` is closed in a `finally`**. The parent
   enforces a hard kill-timeout on the scan child and an overall wall-clock cap.
4. **Single-flight:** scheduled and manual scans share one lock; a second scan never
   starts while one is running.

## Page loading

5. **`networkidle` is never the default wait.** Use `waitUntil: 'load'` → bounded
   `settle_ms` → optional `waitForSelector`. `networkidle` is a per-app override only.
6. Every navigation has a **per-app timeout**; a hung page fails that app, not the batch.
7. Do a **reachability pre-check** before launching the browser; hard-down apps
   (connection refused / DNS / 5xx) are judged without a browser.

## Judgment

8. **App-health is the primary verdict.** Idle / standby / grey tiles are **normal**
   and must never, on their own, produce a `down`. The machine breakdown is
   informational.
9. **Cheap checks before AI.** Vision is called only when the deterministic result is
   ambiguous/`warning` or the app is flagged `is_rich_dashboard`.
10. **AI output is always structured JSON** validated against the verdict schema.
    Unparseable/failed AI → `warning: "vision unavailable"`, **never** a false `down`.
11. **Provider fallback is automatic:** Claude if its key is set, else OpenAI, else
    deterministic-only. On a runtime error/timeout, try the other provider before
    giving up.

## Storage & retention

12. **Verdicts are kept indefinitely; screenshots are pruned at 14 days** (delete the
    file, keep the row, set `screenshot_pruned = 1`).
13. Screenshots are **WebP on disk**, downscaled, referenced by path — never stored
    as DB blobs.
14. SQLite runs in **WAL mode**. Writers are the scan worker; the dashboard reads.

## Security

15. **Escape every user-supplied string on output.** App name and URL are
    attacker-controllable; never interpolate them into HTML unescaped.
16. **SSRF guard on every URL** that the server will fetch: reject loopback,
    link-local, `169.254.169.254`, and private ranges by default; prefer an internal
    allowlist. This runs on add **and** edit.
17. **Settings mutations require the write-token** and CSRF protection. Read endpoints
    may be open on the LAN; write endpoints are not.
18. **Bind to the internal interface** and document the Windows Firewall subnet rule.
19. **Log an audit entry** (source IP + timestamp) on every settings change.

## Secrets & config

20. **Secrets only via `.env`** (or process env). Never commit keys. `.env` is
    git-ignored; `.env.example` documents the variables with no real values.
21. **The user's email / any PII is never sent to an AI provider or third party.**

## Dependencies & build

22. **No frontend build step and no CDN.** Static HTML + vanilla ES-module JS + CSS,
    served locally.
23. **Pin dependency versions** and commit the lockfile. Install must succeed with
    `npm install` / `npm ci` + `npx playwright install chromium` — **no compiler
    required** (rely on prebuilt binaries).
24. **Node is pinned to 22.16.x** in CI to match the VM's ABI. Native modules
    (better-sqlite3) must resolve to a prebuilt win32-x64 binary.
25. **CI is the gate.** No branch is pulled to the VM until the Windows CI job is
    green (install + Chromium + SQLite/Chromium smoke).

## Operational

26. Everything a teammate's browser loads is served by our own service; no external
    network dependency to view the dashboard.
27. Prefer clear failure over silent success: if a scan step is skipped or a provider
    is unavailable, the verdict and the UI must say so.
