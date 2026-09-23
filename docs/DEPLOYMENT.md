# Deployment (Windows Server 2025 VM)

How to run Web Scanner on the target VM. Most of this applies once the code exists in
later phases; Phase 1 only requires the CI check to pass. Commands are PowerShell.

---

## Target environment (verified)

- Windows Server 2025 Datacenter, 64-bit, PowerShell 5.1
- Node.js **v22.16.0**, npm 10.9 (already installed)
- 6 vCPU (AMD EPYC), 10 GB RAM, ~27 GB free on C:
- Outbound HTTPS to `api.anthropic.com` and `api.openai.com` confirmed reachable
- No Docker

## 1. Get the code

```powershell
cd C:\apps
git clone <repo-url> web-scanner   # first time
# or, for an update:
cd C:\apps\web-scanner; git pull
```

## 2. Install dependencies

```powershell
cd C:\apps\web-scanner
npm ci                       # or: npm install (first time, if no lockfile yet)
npx playwright install chromium
```

`npm ci` relies on prebuilt binaries — no compiler needed. If it fails on
`better-sqlite3`, the pinned version's win32-x64 prebuild is missing; see
[DECISIONS.md §7](DECISIONS.md).

## 3. Configure

```powershell
Copy-Item .env.example .env
notepad .env
```

Set at least one AI key (`ANTHROPIC_API_KEY` preferred; `OPENAI_API_KEY` is the
fallback) and confirm `PORT` (default 8080). The full variable list is in
`.env.example`.

## 4. Smoke-test by hand

```powershell
node src\server.js     # open http://localhost:8080 in a browser on the VM
node src\scan.js       # run one scan and watch the output
```

## 5. Install as a service (NSSM)

The dashboard must stay up for teammates and survive reboots. NSSM supervises it.

```powershell
# One-time: download nssm.exe from https://nssm.cc and place it (e.g. C:\tools\nssm.exe)
# Then register the service (a helper script is provided in a later phase):
.\scripts\install-service.ps1
```

The service is set to auto-start on boot and auto-restart on crash, running with no
user logged in. The 7am/7pm schedule runs **inside** this service (node-cron), so no
separate scheduled task is needed for scans.

## 6. Network access

- The dashboard listens on `PORT` (default 8080). Verify it's free first:

  ```powershell
  Get-NetTCPListener -LocalPort 8080 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State,OwningProcess
  ```

- Add a Windows Firewall rule scoped to the **team subnet only** (not Any) so the
  status page and its screenshots are not exposed beyond the intended audience.

## 7. Updating

```powershell
cd C:\apps\web-scanner
git pull
npm ci
npx playwright install chromium   # only if Playwright version changed
# restart the service:
nssm restart WebScannerWeb
```

## Disk & retention

Screenshots are pruned automatically at 14 days. Expect the whole footprint
(`node_modules` + Chromium + ~2 weeks of WebP screenshots + SQLite) to stay around
1–2 GB. The SQLite file and screenshots live under `data/` (git-ignored).
