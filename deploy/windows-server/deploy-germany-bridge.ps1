<#
.SYNOPSIS
  Deploy latest server/index.cjs to production on this Windows host (Germany bridge, port 3001).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\windows-server\deploy-germany-bridge.ps1
#>

$ErrorActionPreference = 'Stop'

$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ServerDir  = Join-Path $RepoRoot 'server'
$EnvFile    = 'C:\ProgramData\SafeTube\bridge.env'
$CookiesSrc = Join-Path $ServerDir 'www.youtube.com_cookies .txt'
$CookiesDst = Join-Path $ServerDir 'cookies.txt'

function Write-Step { param([string]$m) Write-Host "[deploy-bridge] $m" -ForegroundColor Cyan }
function Write-Ok   { param([string]$m) Write-Host "[deploy-bridge] $m" -ForegroundColor Green }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host '[deploy-bridge] Relaunching elevated...' -ForegroundColor Yellow
    $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    Start-Process powershell.exe -Verb RunAs -ArgumentList $arg -Wait
    exit $LASTEXITCODE
}

if (-not (Test-Path $EnvFile)) {
    throw "Missing $EnvFile — run install.ps1 first or copy safetube-bridge.env.example"
}

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

Write-Step "Updating $EnvFile"
$lines = @(Get-Content -LiteralPath $EnvFile -Encoding UTF8)
$keysToReplace = [System.Collections.Generic.HashSet[string]]::new([string[]]@($updates.Keys))
$out = [System.Collections.Generic.List[string]]::new()

foreach ($line in $lines) {
    if ($line -match '^\s*# --- production bridge deploy') { continue }
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

Write-Step 'Installing / resetting SafeTubeBridge (nssm)...'
& (Join-Path $PSScriptRoot 'reset-safetube-bridge-nssm.ps1')
if ($LASTEXITCODE -ne 0) { throw "reset-safetube-bridge-nssm.ps1 failed (exit $LASTEXITCODE)" }

Write-Step 'Applying bridge.env to nssm AppEnvironmentExtra...'
& (Join-Path $PSScriptRoot 'apply-bridge-env-nssm.ps1')
if ($LASTEXITCODE -ne 0) { throw "apply-bridge-env-nssm.ps1 failed (exit $LASTEXITCODE)" }

Start-Sleep -Seconds 3
try {
    $health = Invoke-RestMethod 'http://127.0.0.1:3001/health' -TimeoutSec 15
    Write-Ok "health ok: $($health | ConvertTo-Json -Compress)"
} catch {
    Write-Warning "health check failed: $($_.Exception.Message)"
    if (Test-Path 'C:\ProgramData\SafeTube\logs\bridge.log') {
        Write-Step 'bridge.log tail:'
        Get-Content 'C:\ProgramData\SafeTube\logs\bridge.log' -Tail 25
    }
    throw
}

$vid = 'dQw4w9WgXcQ'
try {
    $stream = Invoke-RestMethod "http://127.0.0.1:3001/api/stream/$vid" -TimeoutSec 120
    Write-Ok "stream: format=$($stream.format) url=$($stream.url)"
    $mediaStatus = (curl.exe -s -o NUL -w '%{http_code}' -r 0-511 "http://127.0.0.1:3001/api/media/$vid")
    Write-Ok "/api/media probe: HTTP $mediaStatus"
} catch {
    Write-Warning "stream/media smoke test: $($_.Exception.Message)"
}

Write-Ok 'Germany bridge deploy complete (port 3001).'
