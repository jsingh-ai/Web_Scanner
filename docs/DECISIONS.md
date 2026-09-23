# Decision Record

Why the design is what it is. These decisions came out of three independent
architecture proposals plus an expert evaluation. Each entry: the decision, the
alternatives considered, and the reasoning. If you want to change one, read the
reasoning first.

---

## 1. Two decoupled processes (dashboard + short-lived scan worker)

**Decision:** An always-on Fastify dashboard that never launches a browser, plus a
`scan.js` worker spawned per scan that exits when done.

**Alternatives:** One process doing both (dashboard + in-process browser + cron).

**Why:** Playwright/Chromium leaks memory over long-lived sessions and can leave
orphan `chrome.exe` processes on Windows. The strongest possible mitigation is to
let the whole scan be a short-lived process — the OS reclaims all browser memory on
exit. A single always-on process running Chromium twice a day for months is the
exact pattern that bloats and eventually OOMs on a 10 GB VM. Decoupling also isolates
faults: a hung scan can't take down the status page teammates are viewing.

## 2. Scheduler: in-process node-cron + startup catch-up (not Windows Task Scheduler)

**Decision:** `node-cron` inside the always-on service at 07:00 / 19:00, a catch-up
check on service start, and a single-flight lock shared with the Run-now button.

**Alternatives:** Windows Task Scheduler with `StartWhenAvailable=true` launching
`scan.js` directly.

**Why:** Task Scheduler is genuinely durable, but its one real edge — surviving long
downtime / clock jumps — is marginal here because an auto-restarting service is
**already required** for the dashboard, so process downtime is seconds. The
"in-memory cron misses a window while the process is down" objection is fully covered
by the startup catch-up check. Embedding the scheduler also makes **Run now** a direct
in-process call sharing one lock, instead of a separate `schtasks /Run` + cross-process
lockfile. Fewer moving parts, same reboot-safety.

## 3. Keep-alive: NSSM (not node-windows)

**Decision:** NSSM supervises the dashboard as an auto-start, auto-restart Windows
service. **WinSW** is an acceptable equivalent if a repo-declared (XML) service is
preferred.

**Alternatives:** `node-windows`, native Task Scheduler at boot, PM2.

**Why:** `node-windows` has **verified** compatibility problems on Windows Server
2022/2025 and is effectively unmaintained (it bundles an old `winsw.exe`). NSSM is
the boring, currently-compatible choice: auto-start, auto-restart on crash, runs
before login, headless. Native Task Scheduler can start a process at boot but its
crash-monitoring is weaker than a real service. Do not use node-windows.

## 4. Vision model: current Claude vision model default, cheaper Claude as a knob

**Decision:** Default to a current vision-capable Claude model; expose the model as a
single env var so it can be dropped to a cheaper Claude model. Claude is preferred;
OpenAI is the automatic fallback.

**Alternatives:** Default to the cheaper model to minimize cost.

**Why:** At ~40 escalated judgments/day the cost difference between the top and
mid-tier Claude models is only a few dollars a month — immaterial. The whole reason
vision is invoked is the subtle "grey standby tile is normal, not a failure"
judgment, where accuracy matters more than saving ~$13/month. Making it one config
value means the cost-conscious choice is always one edit away. Exact model IDs and
current pricing live in the bundled Claude API reference and are pinned at build time
in later phases.

## 5. Page-load wait: load + settle + selector (networkidle banned as default)

**Decision:** `waitUntil: 'load'` → bounded settle → optional `waitForSelector`.
`networkidle` is available only as an explicit per-app override.

**Alternatives:** `networkidle` as the default wait (two of the three proposals used it).

**Why:** This is the highest-consequence call for this workload. Continuously-polling
dashboards (SCADA/OPC over XHR/WebSocket/long-poll) may **never** reach network-idle,
so `networkidle` risks systematic hangs and false-downs on precisely the industrial
apps this tool exists to watch. Playwright's own guidance discourages `networkidle`.

## 6. Storage: better-sqlite3 (WAL) + WebP screenshots on disk

**Decision:** better-sqlite3 in WAL mode for verdicts (kept forever); downscaled WebP
screenshots on disk (pruned at 14 days), referenced by path.

**Alternatives:** JPEG screenshots; screenshots as BLOBs in the DB; `node:sqlite`.

**Why:** SQLite is a single file with no server — ideal for a locked-down Windows VM.
WAL lets the dashboard read while a scan writes. Keeping images on disk (not in the
DB) keeps the DB tiny and makes 14-day pruning trivial. `node:sqlite` is **not** used
as a fallback — in Node 22.16 it is experimental/flagged with a different API, so it
is not a drop-in. If better-sqlite3 prebuilds are ever a concern, vendoring the single
prebuilt `.node` is the cleaner fallback than an API rewrite.

**Update (Phase 3) — screenshots are JPEG, not WebP.** Playwright emits PNG/JPEG
natively but not WebP; producing WebP would require adding `sharp` (another native
module) purely for a format conversion. At this scale the disk saving is negligible
(~560 images, well under 1 GB of ~27 GB free), so we use Playwright-native **JPEG
q72** and avoid the extra dependency and its de-risking. If disk ever gets tight, the
single, isolated place to add `sharp` + WebP is `src/storage/screenshots.js`.

## 7. Native-module reliability: prebuilt binary as a hard requirement, verified in CI

**Decision:** Pin a better-sqlite3 version with confirmed win32-x64 prebuilds for
Node 22 (ABI 127). Commit a lockfile, install with `npm ci`, and make GitHub Actions
the gate: a Windows runner pinned to Node **22.16.x** runs the install + a smoke step
that actually requires better-sqlite3, opens a DB, and launches Chromium.

**Why:** The user cannot build locally, so a compiler-required install would be a
dead end. The CI's ABI-matched Windows runner proves a clean, prebuilt install before
the branch is ever pulled to the VM.

## 8. Security of the no-login settings UI: mitigations are mandatory

**Decision:** Keep "no login," but require: SSRF guard on URLs, output escaping
(stored-XSS), a shared write-token + CSRF on mutations, LAN-bind + subnet firewall,
and an audit log.

**Why:** The feature "type a URL and the server fetches/screenshots it," exposed with
no auth on a shared network, is a textbook SSRF sink and the rendered app name/URL is
a stored-XSS sink. "No login" describes authentication, not a licence to skip these.
These close the real holes while preserving the frictionless UX the user asked for.

**Update (Phase 6) — SSRF guard allows private LAN, blocks only the real targets.**
The monitored apps live on the internal network (private IPs), so a blanket
private-range block would break the tool. The guard (`src/security/ssrf.js`) blocks
only loopback, link-local + the `169.254.169.254` metadata endpoint, and the
unspecified address — never legitimate targets — while allowing 10/8, 172.16/12,
192.168/16 and IPv6 ULA. An optional `SCAN_URL_ALLOWLIST` narrows it further. CSRF is
covered by requiring a custom header (`x-write-token`) on mutations, which a cross-site
form cannot set. The "audit log" is a mutation log line (source IP + result) written to
the service log (captured by NSSM), not a separate store.

## 9. No frontend build step, no CDN

**Decision:** Static HTML + vanilla ES-module JS + CSS served locally by Fastify.

**Why:** The user cannot run builds locally and verification is CI-only, so a bundler
would add a compile step with no place to run it comfortably. Serving everything
locally (no CDN) also means teammate browsers on a restricted network don't need
outbound internet to load the dashboard.
