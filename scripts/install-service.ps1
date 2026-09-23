# Registers the Web Scanner dashboard (src/server.js) as an auto-start Windows service
# using NSSM, so it stays up across reboots and restarts on crash. The 7am/7pm scans
# run IN-PROCESS inside this service (node-cron), so there is no separate scan task.
#
# Prerequisites:
#   - Run in an ELEVATED PowerShell (service registration needs admin).
#   - nssm.exe on PATH, or pass -NssmPath "C:\tools\nssm.exe" (download from https://nssm.cc).
#   - `npm ci` and `npx playwright install chromium` already run in the repo.
#   - A .env file created (at least one AI key + a WRITE_TOKEN).
#
# Usage:
#   .\scripts\install-service.ps1
#   .\scripts\install-service.ps1 -ServiceName WebScannerWeb -NssmPath C:\tools\nssm.exe
#
# To remove later:  nssm remove WebScannerWeb confirm

param(
  [string]$ServiceName = "WebScannerWeb",
  [string]$NssmPath = "nssm"
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$server = Join-Path $repo "src\server.js"
$logDir = Join-Path $repo "data\logs"

if (-not (Test-Path $server)) { throw "server.js not found at $server" }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host "Installing service '$ServiceName'"
Write-Host "  node:   $node"
Write-Host "  server: $server"
Write-Host "  cwd:    $repo"

& $NssmPath install $ServiceName $node $server
& $NssmPath set $ServiceName AppDirectory $repo
& $NssmPath set $ServiceName AppStdout (Join-Path $logDir "server.out.log")
& $NssmPath set $ServiceName AppStderr (Join-Path $logDir "server.err.log")
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateBytes 10485760
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath set $ServiceName AppExit Default Restart
& $NssmPath set $ServiceName AppRestartDelay 5000
& $NssmPath set $ServiceName DisplayName "Web Scanner Dashboard"
& $NssmPath set $ServiceName Description "Internal web app status monitor (dashboard + in-process 7am/7pm scans)"

Write-Host ""
Write-Host "Done. Start it with:   nssm start $ServiceName"
Write-Host "Logs:                  $logDir"
