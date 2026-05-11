<#
.SYNOPSIS
    Generates a fresh YouTube PO token + visitor_data pair, atomically updates the
    bridge env file, and restarts the SafeTubeBridge service.

.DESCRIPTION
    Triggered by the SafeTube-PO-Token-Refresh scheduled task every 4 hours.
    The two YOUTUBE_PO_TOKEN / YOUTUBE_VISITOR_DATA lines in the env file are
    replaced atomically (write to a tmp file in the same directory, then rename),
    so a crash mid-write cannot corrupt the file.

    Failures are non-fatal -- the bridge keeps using the previous (still-valid
    for ~6h) tokens until the next scheduled retry.

.PARAMETER EnvFile
    Path to the bridge env file. Default: C:\ProgramData\SafeTube\bridge.env

.PARAMETER GeneratorDir
    Directory containing this folder's package.json + node_modules.
    Default: C:\Program Files\SafeTube\generator

.PARAMETER BridgeServiceName
    Name of the Windows service to restart after rotation. Default: SafeTubeBridge

.PARAMETER PoTokenScope
    yt-dlp PO token scope prefix. Default: web.gvs
    Try `web`, `mweb.gvs`, or comma-joined multi-client if web.gvs is rejected.
#>

#Requires -Version 5.1

param(
    [string]$EnvFile           = 'C:\ProgramData\SafeTube\bridge.env',
    [string]$GeneratorDir      = 'C:\Program Files\SafeTube\generator',
    [string]$BridgeServiceName = 'SafeTubeBridge',
    [string]$PoTokenScope      = 'web.gvs'
)

$ErrorActionPreference = 'Stop'

function Write-Status { param([string]$msg) Write-Host "[refresh-pot] $msg" }
function Throw-Err    { param([string]$msg) Write-Host "[refresh-pot] ERROR: $msg" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $EnvFile))      { Throw-Err "env file not found: $EnvFile" }
if (-not (Test-Path $GeneratorDir)) { Throw-Err "generator dir not found: $GeneratorDir" }

# ---- locate node.exe + npm --------------------------------------------------
$nodeDir = Join-Path $env:ProgramFiles 'nodejs'
if (Test-Path $nodeDir) {
    $env:PATH = "$nodeDir;$env:PATH"
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    Throw-Err "node.exe not on PATH for this task -- install Node 18+ or update task env"
}

Set-Location $GeneratorDir

# ---- install generator deps on first run (idempotent) ----------------------
if (-not (Test-Path 'node_modules')) {
    Write-Status "installing youtube-po-token-generator..."
    & npm.cmd install --silent --no-audit --no-fund --no-progress
    if ($LASTEXITCODE -ne 0) { Throw-Err "npm install failed (exit $LASTEXITCODE)" }
}

# ---- generate a fresh pair --------------------------------------------------
Write-Status "generating PO token + visitor_data pair..."
$cliExe = Join-Path $GeneratorDir 'node_modules\.bin\youtube-po-token-generator.cmd'
if (-not (Test-Path $cliExe)) { Throw-Err "generator CLI not found at $cliExe -- try `npm install` in $GeneratorDir" }

# Capture stdout (JSON). Stderr goes to the task's transcript file.
$json = & $cliExe 2>$null
if (-not $json) { Throw-Err "generator returned empty output (network? rate-limit? try again in 60s)" }

try {
    $parsed = $json | ConvertFrom-Json
} catch {
    Throw-Err "generator output was not valid JSON: $json"
}

$poToken     = $parsed.poToken
$visitorData = $parsed.visitorData

if ([string]::IsNullOrWhiteSpace($poToken))     { Throw-Err "generator returned empty poToken" }
if ([string]::IsNullOrWhiteSpace($visitorData)) { Throw-Err "generator returned empty visitorData" }

Write-Status ("generated pair (poToken len={0}, visitorData len={1})" -f $poToken.Length, $visitorData.Length)

# ---- atomic env file rewrite ------------------------------------------------
# Keep tmp file on the same drive/dir as the target so Move-Item is a true rename.
$envDir = Split-Path -Parent $EnvFile
$tmpFile = Join-Path $envDir ("bridge.env." + ([guid]::NewGuid().ToString('N')) + ".tmp")

$existing  = Get-Content -Path $EnvFile -Encoding UTF8
$filtered  = $existing | Where-Object { $_ -notmatch '^\s*YOUTUBE_(PO_TOKEN|VISITOR_DATA)\s*=' }
$newLines  = @($filtered) + @(
    "YOUTUBE_PO_TOKEN=${PoTokenScope}+${poToken}",
    "YOUTUBE_VISITOR_DATA=${visitorData}"
)

# Set-Content with -NoNewline=false (default) writes a trailing newline. UTF8 (no BOM in PS 7,
# WITH BOM in PS 5.1 -- both are acceptable to the bridge's env loader since the regex tolerates
# leading whitespace and the BOM is on the first byte only, not on each line).
Set-Content -Path $tmpFile -Value $newLines -Encoding UTF8
Move-Item -Path $tmpFile -Destination $EnvFile -Force
Write-Status "env file rewritten ($EnvFile)"

# ---- restart bridge ---------------------------------------------------------
$svc = Get-Service -Name $BridgeServiceName -ErrorAction SilentlyContinue
if (-not $svc) { Throw-Err "service $BridgeServiceName not found -- was install.ps1 run?" }

Write-Status "restarting service $BridgeServiceName..."
Restart-Service -Name $BridgeServiceName -Force
Write-Status "rotation complete."
