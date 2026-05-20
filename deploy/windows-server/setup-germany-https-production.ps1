<#
.SYNOPSIS
  One-shot: HTTPS Cloudflare Tunnel -> Germany bridge :3001, update .env.production, push, Vercel redeploy.

.DESCRIPTION
  Run ONCE (elevated recommended for nssm). All steps in this single script.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\windows-server\setup-germany-https-production.ps1
#>

$ErrorActionPreference = 'Stop'

# ─── Paths ───────────────────────────────────────────────────────────────────
$RepoRoot     = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ServerDir    = Join-Path $RepoRoot 'server'
$DeployDir    = Join-Path $RepoRoot 'deploy\windows-server'
$DataDir      = Join-Path $env:ProgramData 'SafeTube'
$LogDir       = Join-Path $DataDir 'logs'
$TunnelLog    = Join-Path $LogDir 'cloudflared-tunnel.log'
$TunnelUrlFile = Join-Path $DataDir 'public-tunnel-url.txt'
$CookiesSrc   = Join-Path $ServerDir 'www.youtube.com_cookies .txt'
$CookiesDst   = Join-Path $ServerDir 'cookies.txt'
$EnvProduction = Join-Path $RepoRoot '.env.production'
$BridgePort   = 3001

New-Item -ItemType Directory -Force -Path $LogDir, $DataDir | Out-Null

function Write-Step { param([string]$m) Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok   { param([string]$m) Write-Host "OK: $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "WARN: $m" -ForegroundColor Yellow }

Write-Host @'

  SafeTube - Germany HTTPS production setup (single script)
  -------------------------------------------------------

'@ -ForegroundColor White

# ─── 1. cloudflared ──────────────────────────────────────────────────────────
Write-Step 'Locate cloudflared'
$Cloudflared = $null
$cmd = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
if ($cmd) { $Cloudflared = $cmd.Source }
if (-not $Cloudflared) {
  foreach ($p in @(
    "${env:ProgramFiles}\cloudflared\cloudflared.exe",
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\cloudflared.exe')
  )) {
    if ($p -and (Test-Path $p)) { $Cloudflared = $p; break }
  }
}
if (-not $Cloudflared) {
  Write-Step 'Install cloudflared via winget'
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  $cmd = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($cmd) { $Cloudflared = $cmd.Source }
}
if (-not $Cloudflared) { throw 'cloudflared.exe not found after install attempt' }
Write-Ok "cloudflared = $Cloudflared"

# ─── 2. Cookies + npm ────────────────────────────────────────────────────────
Write-Step 'Sync cookies and npm install (server/)'
if (Test-Path $CookiesSrc) {
  Copy-Item -Force $CookiesSrc $CookiesDst
  Write-Ok 'cookies.txt updated'
} elseif (-not (Test-Path $CookiesDst)) {
  throw "Missing cookies: $CookiesSrc"
}
Push-Location $ServerDir
& npm install --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install failed ($LASTEXITCODE)" }
Pop-Location
Write-Ok 'server dependencies'

# ─── 3. Media bridge on :3001 ──────────────────────────────────────────────
Write-Step "Start Media Bridge on port $BridgePort"
Get-NetTCPConnection -LocalPort $BridgePort -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

$bridgeEnv = @{
  PORT          = "$BridgePort"
  HOST          = '0.0.0.0'
  COOKIES_FILE  = './cookies.txt'
  POT_URL       = 'http://127.0.0.1:26148'
  YT_DLP_FORMAT = 'best[height<=720][ext=mp4][vcodec!=none][acodec!=none]/best[ext=mp4][vcodec!=none][acodec!=none]/22/18/best[height<=720][ext=mp4]/best[ext=mp4]'
  YT_CLIENT_CHAIN = 'tv,web_embedded,ios,android'
}
foreach ($kv in $bridgeEnv.GetEnumerator()) {
  Set-Item -Path "Env:$($kv.Key)" -Value $kv.Value
}
Remove-Item Env:PUBLIC_BRIDGE_ORIGIN -ErrorAction SilentlyContinue

Start-Process -FilePath 'node.exe' -ArgumentList 'index.cjs' -WorkingDirectory $ServerDir -WindowStyle Hidden
Start-Sleep -Seconds 4

$healthLocal = curl.exe -s -m 10 "http://127.0.0.1:${BridgePort}/health"
if ($healthLocal -notmatch '"ok":true') { throw "Bridge health failed on :${BridgePort}: $healthLocal" }
Write-Ok "bridge http://127.0.0.1:$BridgePort/health"

# ─── 4. Cloudflare quick tunnel (HTTPS) ────────────────────────────────────
Write-Step 'Start Cloudflare HTTPS tunnel -> localhost:3001'
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

if (Test-Path $TunnelLog) { Remove-Item -Force $TunnelLog }
$cfProc = Start-Process -FilePath $Cloudflared -ArgumentList @(
  'tunnel', '--url', "http://127.0.0.1:$BridgePort", '--loglevel', 'info'
) -RedirectStandardError $TunnelLog -WindowStyle Hidden -PassThru

Write-Host "cloudflared PID $($cfProc.Id) - waiting for trycloudflare.com URL..." -ForegroundColor DarkGray

$tunnelUrl = $null
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  if (-not (Test-Path $TunnelLog)) { continue }
  $m = Select-String -Path $TunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches |
    ForEach-Object { $_.Matches } | ForEach-Object { $_.Value } | Select-Object -First 1
  if ($m) { $tunnelUrl = $m.TrimEnd('/'); break }
}
if (-not $tunnelUrl) {
  Write-Host '--- cloudflared log tail ---' -ForegroundColor Yellow
  if (Test-Path $TunnelLog) { Get-Content $TunnelLog -Tail 30 }
  throw 'Could not read tunnel URL from log within 45s'
}
Set-Content -Path $TunnelUrlFile -Value $tunnelUrl -Encoding utf8 -NoNewline
Write-Ok "HTTPS tunnel: $tunnelUrl"

# ─── 5. Verify tunnel ──────────────────────────────────────────────────────
Write-Step 'Verify tunnel /health and /api/stream'
$healthTls = curl.exe -s -m 20 "$tunnelUrl/health"
if ($healthTls -notmatch '"ok":true') { throw "Tunnel /health failed: $healthTls" }
Write-Ok 'tunnel /health'

$streamJson = curl.exe -s -m 120 "$tunnelUrl/api/stream/dQw4w9WgXcQ"
if ($streamJson -notmatch '"format":"direct"') { throw "Tunnel /api/stream failed: $streamJson" }
if ($streamJson -notmatch [regex]::Escape($tunnelUrl)) {
  throw "Stream JSON must use HTTPS tunnel for /api/media (got: $streamJson)"
}
Write-Ok 'tunnel returns HTTPS playback URLs'

$mediaCode = '000'
foreach ($attempt in 1..3) {
  $mediaCode = curl.exe -s -o NUL -w '%{http_code}' -r 0-2048 "$tunnelUrl/api/media/gO-BG4rUfZw" --max-time 120
  if ($mediaCode -eq '206' -or $mediaCode -eq '200') { break }
  Write-Warn "Tunnel /api/media attempt $attempt HTTP $mediaCode - retrying..."
  Start-Sleep -Seconds 3
}
if ($mediaCode -ne '206' -and $mediaCode -ne '200') {
  Write-Warn "Tunnel /api/media returned HTTP $mediaCode (stream metadata OK; continuing deploy)"
} else {
  Write-Ok "/api/media HTTP $mediaCode"
}

# ─── 6. Update .env.production (Vite bake at build) ────────────────────────
Write-Step 'Update .env.production'
@"
# Germany Media Bridge via Cloudflare Tunnel (HTTPS - no mixed content on Vercel/mobile).
# Tunnel URL is written by setup-germany-https-production.ps1 - re-run if cloudflared restarts.
# Stable hostname: configure a named Cloudflare Tunnel in Zero Trust (optional).
VITE_STREAM_API_BASE=$tunnelUrl
"@ | Set-Content -Path $EnvProduction -Encoding utf8 -NoNewline
Write-Ok ".env.production -> $tunnelUrl"

# ─── 7. Optional: nssm service for cloudflared (persistent) ───────────────
Write-Step 'Register cloudflared as Windows service (optional persistence)'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$ServiceName = 'SafeTubeCloudflared'
if ($isAdmin) {
  $nssm = Get-Command nssm.exe -ErrorAction SilentlyContinue
  if (-not $nssm) {
    $wingetNssm = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\nssm.exe'
    if (Test-Path $wingetNssm) { $nssm = @{ Source = $wingetNssm } }
  }
  if ($nssm) {
    & $nssm.Source stop $ServiceName 2>$null | Out-Null
    & $nssm.Source remove $ServiceName confirm 2>$null | Out-Null
    & $nssm.Source install $ServiceName $Cloudflared | Out-Null
    & $nssm.Source set $ServiceName AppParameters "tunnel --url http://127.0.0.1:$BridgePort" | Out-Null
    & $nssm.Source set $ServiceName DisplayName 'SafeTube Cloudflare Tunnel' | Out-Null
    & $nssm.Source set $ServiceName Start SERVICE_AUTO_START | Out-Null
    & $nssm.Source set $ServiceName AppStdout $TunnelLog | Out-Null
    & $nssm.Source set $ServiceName AppStderr $TunnelLog | Out-Null
    Stop-Process -Id $cfProc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    & $nssm.Source start $ServiceName | Out-Null
    Write-Warn 'SafeTubeCloudflared service installed - quick-tunnel URL may CHANGE after service restart; re-run this script and redeploy if URL changes.'
  } else {
    Write-Warn 'nssm not found - cloudflared left as background process only (PID was started above).'
  }
} else {
  Write-Warn 'Not elevated - skipped nssm service for cloudflared (tunnel process still running).'
}

# ─── 8. Git commit + push (triggers Vercel Git integration) ────────────────
Write-Step 'Git commit and push .env.production'
Push-Location $RepoRoot
git add .env.production
$commitMsg = @"
fix(production): point VITE_STREAM_API_BASE at Germany HTTPS Cloudflare tunnel

Mobile/Vercel HTTPS was blocked by mixed content (http://176.9.82.81:3001).
Tunnel: $tunnelUrl
"@
$msgFile = Join-Path $RepoRoot '.git\COMMIT_MSG_TUNNEL.txt'
Set-Content -Path $msgFile -Value $commitMsg -Encoding utf8
git commit -F $msgFile 2>&1 | Write-Host
if ($LASTEXITCODE -ne 0) {
  Write-Warn 'git commit skipped (nothing to commit or hook issue) - check git status'
} else {
  git push origin main 2>&1 | Write-Host
  if ($LASTEXITCODE -eq 0) { Write-Ok 'pushed to origin/main - Vercel should auto-deploy' }
  else { Write-Warn 'git push failed — push manually' }
}
Pop-Location

# ─── 9. Vercel CLI (if logged in) ──────────────────────────────────────────
Write-Step 'Vercel env + production deploy (if CLI available)'
Push-Location $RepoRoot
function Invoke-VercelCli {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArgs)
  $vercel = Get-Command vercel -ErrorAction SilentlyContinue
  if ($vercel) {
    & $vercel.Source @CliArgs
  } else {
    & npx --yes vercel @CliArgs
  }
}
try {
  Invoke-VercelCli whoami 2>&1 | Write-Host
  if ($LASTEXITCODE -eq 0) {
    $tunnelUrl | Invoke-VercelCli env add VITE_STREAM_API_BASE production --force 2>&1 | Write-Host
    Invoke-VercelCli --prod --yes 2>&1 | Write-Host
    if ($LASTEXITCODE -eq 0) { Write-Ok 'vercel --prod deploy triggered' }
  } else {
    Write-Warn 'Vercel CLI not logged in - set VITE_STREAM_API_BASE in Vercel dashboard; git push should still trigger deploy.'
  }
} catch {
  Write-Warn "Vercel CLI skipped: $($_.Exception.Message)"
}
Pop-Location

# ─── Done ──────────────────────────────────────────────────────────────────
Write-Host @"

============================================================
  SUCCESS - Germany bridge is HTTPS for production
============================================================

  Tunnel URL (save this):
    $tunnelUrl

  Saved to:
    $TunnelUrlFile

  Vercel Production env (also set manually if git push alone is not enough):
    VITE_STREAM_API_BASE = $tunnelUrl

  Test from phone browser:
    $tunnelUrl/health

  After Vercel deploy finishes, open your production app and play a video.

  NOTE: Quick tunnel URLs change when cloudflared restarts.
        For a permanent hostname, add a named tunnel in Cloudflare Zero Trust.

============================================================

"@ -ForegroundColor Green
