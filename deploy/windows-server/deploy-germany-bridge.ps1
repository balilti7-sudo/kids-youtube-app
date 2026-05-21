<#
.SYNOPSIS
  Deploy latest Media Bridge to Germany (nssm SafeTubeBridge, port 3001).

  Includes email routes: /api/email/welcome, /pairing-reminder, /pin, /pin-changed
  (PIN-changed confirmation - no PIN in email body).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows-server\deploy-germany-bridge.ps1

  Or double-click: deploy-germany-bridge-admin.cmd
#>

$ErrorActionPreference = 'Stop'

$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ServerDir  = Join-Path $RepoRoot 'server'
$EnvFile    = 'C:\ProgramData\SafeTube\bridge.env'
$BridgeLog  = 'C:\ProgramData\SafeTube\logs\bridge.log'
$CookiesSrc = Join-Path $ServerDir 'www.youtube.com_cookies .txt'
$CookiesDst = Join-Path $ServerDir 'cookies.txt'

function Write-Step { param([string]$m) Write-Host "[deploy-bridge] $m" -ForegroundColor Cyan }
function Write-Ok   { param([string]$m) Write-Host "[deploy-bridge] $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "[deploy-bridge] $m" -ForegroundColor Yellow }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host '[deploy-bridge] Relaunching elevated...' -ForegroundColor Yellow
    $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    Start-Process powershell.exe -Verb RunAs -ArgumentList $arg -Wait
    exit $LASTEXITCODE
}

if (-not (Test-Path $EnvFile)) {
    throw "Missing $EnvFile - run install.ps1 first or copy safetube-bridge.env.example"
}

Write-Step 'Verify email route files in server/'
$emailFiles = @(
    (Join-Path $ServerDir 'email\sendPinChanged.js'),
    (Join-Path $ServerDir 'email\welcomeRoute.js'),
    (Join-Path $ServerDir 'register-email-routes.mjs')
)
foreach ($f in $emailFiles) {
    if (-not (Test-Path $f)) { throw "Missing required file: $f (git pull main?)" }
}
Write-Ok 'email modules present (pin-changed, welcomeRoute, register-email-routes)'

Write-Step "Syncing cookies → $CookiesDst"
if (Test-Path $CookiesSrc) {
    Copy-Item -Force $CookiesSrc $CookiesDst
} elseif (-not (Test-Path $CookiesDst)) {
    throw "No cookies file at $CookiesSrc or $CookiesDst"
}

Write-Step 'npm install in server/'
Push-Location $ServerDir
& npm install --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install failed (exit $LASTEXITCODE)" }
Pop-Location

$muxedFormat =
    'best[height<=720][ext=mp4][vcodec!=none][acodec!=none]/' +
    'best[ext=mp4][vcodec!=none][acodec!=none]/' +
    '22/18/' +
    'best[height<=720][ext=mp4]/best[ext=mp4]'

$updates = [ordered]@{
    PORT              = '3001'
    HOST              = '0.0.0.0'
    COOKIES_FILE      = './cookies.txt'
    YT_DLP_COOKIES_FILE = './cookies.txt'
    YT_DLP_FORMAT     = $muxedFormat
    POT_URL           = 'http://127.0.0.1:26148'
    YT_CLIENT_CHAIN   = 'tv,web_embedded,ios,android'
    PUBLIC_BRIDGE_ORIGIN = 'http://176.9.82.81:3001'
}

Write-Step "Updating $EnvFile (streaming keys)"
$lines = @(Get-Content -LiteralPath $EnvFile -Encoding UTF8)
$keysToReplace = [System.Collections.Generic.HashSet[string]]::new([string[]]@($updates.Keys))
$out = [System.Collections.Generic.List[string]]::new()

foreach ($line in $lines) {
    if ($line -match '^\s*# --- production bridge deploy') { continue }
    if ($line -match '^\s*# --- email routes') { continue }
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
        if ($keysToReplace.Contains($Matches[1])) { continue }
    }
    $out.Add($line) | Out-Null
}

$out.Add('') | Out-Null
$out.Add('# --- production bridge deploy (deploy-germany-bridge.ps1) ---') | Out-Null
foreach ($e in $updates.GetEnumerator()) {
    $out.Add("$($e.Key)=$($e.Value)") | Out-Null
}
Set-Content -LiteralPath $EnvFile -Value $out -Encoding utf8

Write-Step 'Populate production email secrets in bridge.env'
$populateScript = Join-Path $PSScriptRoot 'populate-bridge-env.ps1'
if (-not (Test-Path $populateScript)) {
    throw "Missing $populateScript"
}
& $populateScript
if ($LASTEXITCODE -ne 0) { throw "populate-bridge-env.ps1 failed (exit $LASTEXITCODE)" }
Write-Ok 'bridge.env email + Supabase keys populated'

Write-Step 'Installing / resetting SafeTubeBridge (nssm) - loads latest index.cjs + email routes'
& (Join-Path $PSScriptRoot 'reset-safetube-bridge-nssm.ps1')
if ($LASTEXITCODE -ne 0) { throw "reset-safetube-bridge-nssm.ps1 failed (exit $LASTEXITCODE)" }

Write-Step 'Applying bridge.env to nssm AppEnvironmentExtra...'
& (Join-Path $PSScriptRoot 'apply-bridge-env-nssm.ps1')
if ($LASTEXITCODE -ne 0) { throw "apply-bridge-env-nssm.ps1 failed (exit $LASTEXITCODE)" }

Start-Sleep -Seconds 4

try {
    $health = Invoke-RestMethod 'http://127.0.0.1:3001/health' -TimeoutSec 15
    Write-Ok "health ok: $($health | ConvertTo-Json -Compress)"
} catch {
    Write-Warn "health check failed: $($_.Exception.Message)"
    if (Test-Path $BridgeLog) {
        Write-Step 'bridge.log tail:'
        Get-Content $BridgeLog -Tail 30
    }
    throw
}

if (Test-Path $BridgeLog) {
    $logTail = Get-Content $BridgeLog -Tail 50 | Out-String
    if ($logTail -match 'pin-changed') {
        Write-Ok 'bridge.log confirms email routes registered (/pin-changed)'
    } else {
        Write-Warn 'bridge.log missing pin-changed line - check register-email-routes.mjs loaded'
        Get-Content $BridgeLog -Tail 15
    }
}

function Test-EmailRoute {
    param([string]$Path, [string]$Label)
    $code = curl.exe -s -o NUL -w '%{http_code}' -X POST `
        -H 'Content-Type: application/json' `
        -d '{}' `
        "http://127.0.0.1:3001$Path"
    if ($code -eq '404') {
        throw "POST $Path returned 404 - email routes not mounted"
    }
    if ($code -eq '503') {
        Write-Warn "POST $Path -> 503 (set RESEND_API_KEY in bridge.env)"
    } elseif ($code -in @('401', '400')) {
        Write-Ok "POST $Path -> HTTP $code ($Label route OK)"
    } else {
        Write-Ok "POST $Path -> HTTP $code"
    }
}

Write-Step 'Smoke test email routes (expect 401/400 without auth body)'
Test-EmailRoute '/api/email/pin-changed' 'pin-changed'
Test-EmailRoute '/api/email/pin-reset-request' 'pin-reset-request'

$vid = 'dQw4w9WgXcQ'
try {
    $stream = Invoke-RestMethod "http://127.0.0.1:3001/api/stream/$vid" -TimeoutSec 120
    Write-Ok "stream: format=$($stream.format) url=$($stream.url)"
    $mediaStatus = (curl.exe -s -o NUL -w '%{http_code}' -r 0-511 "http://127.0.0.1:3001/api/media/$vid")
    Write-Ok "/api/media probe: HTTP $mediaStatus"
} catch {
    Write-Warn "stream/media smoke test: $($_.Exception.Message)"
}

Write-Ok 'Germany bridge deploy complete (port 3001, email routes included).'
