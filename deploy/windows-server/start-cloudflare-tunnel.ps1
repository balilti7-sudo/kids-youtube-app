<#
.SYNOPSIS
  Expose the local Media Bridge (port 3001) over HTTPS via Cloudflare quick tunnel.

.DESCRIPTION
  Run on the Germany server after SafeTubeBridge is listening on 127.0.0.1:3001.
  Prints an https://*.trycloudflare.com URL — set that as:
    - VITE_STREAM_API_BASE in Vercel (Production env)
    - PUBLIC_BRIDGE_ORIGIN in C:\ProgramData\SafeTube\bridge.env
  Then restart the bridge service.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\windows-server\start-cloudflare-tunnel.ps1
#>

$ErrorActionPreference = 'Stop'

$BridgePort = 3001
$LogDir = Join-Path $env:ProgramData 'SafeTube\logs'
$LogFile = Join-Path $LogDir 'cloudflared-tunnel.log'

function Find-Cloudflared {
  $cmd = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @(
    "${env:ProgramFiles}\cloudflared\cloudflared.exe",
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\cloudflared.exe')
  )) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  throw 'cloudflared.exe not found. Install: winget install Cloudflare.cloudflared'
}

$cf = Find-Cloudflared
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$listener = Get-NetTCPConnection -LocalPort $BridgePort -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
  throw "Nothing listening on port $BridgePort. Start SafeTubeBridge first."
}

Write-Host "[cloudflared] HTTPS tunnel -> http://127.0.0.1:$BridgePort" -ForegroundColor Cyan
Write-Host "[cloudflared] Log: $LogFile" -ForegroundColor DarkGray
Write-Host '[cloudflared] Copy the https://....trycloudflare.com URL into Vercel VITE_STREAM_API_BASE' -ForegroundColor Yellow

& $cf tunnel --url "http://127.0.0.1:$BridgePort" 2>&1 | Tee-Object -FilePath $LogFile
