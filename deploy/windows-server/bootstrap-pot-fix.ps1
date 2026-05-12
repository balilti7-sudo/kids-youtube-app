<#
.SYNOPSIS
    One-shot fix-up script that swaps the broken `youtube-po-token-generator`
    install in C:\Program Files\SafeTube\generator\ for our custom
    bgutils-js + minimal-jsdom generator (`generate-po-token.mjs`), then
    generates the first PO token / visitor_data pair and writes it to
    C:\ProgramData\SafeTube\bridge.env, then restarts the SafeTubeBridge
    service and registers the missing SafeTube-PO-Token-Refresh task.

.DESCRIPTION
    The `youtube-po-token-generator` npm package OOM'd at 8 GB heap on this
    machine (jsdom fetched & parsed the full https://www.youtube.com/embed
    page). Our generator (`generate-po-token.mjs`) does the same job via
    `bgutils-js` + an empty jsdom in ~250 ms with <200 MB RAM.

    This script is safe to run multiple times -- everything it does is
    idempotent.

.USAGE
    From an *elevated* PowerShell prompt:

        cd C:\Users\eladtheking1010\kids-youtube-app
        powershell -ExecutionPolicy Bypass -File .\deploy\windows-server\bootstrap-pot-fix.ps1
#>

#Requires -Version 5.1
#Requires -RunAsAdministrator

[CmdletBinding()]
param(
    [string]$AppDir            = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
    [string]$InstallDir        = (Join-Path $env:ProgramFiles 'SafeTube'),
    [string]$DataDir           = (Join-Path $env:ProgramData 'SafeTube'),
    [string]$BridgeServiceName = 'SafeTubeBridge',
    [string]$TaskName          = 'SafeTube-PO-Token-Refresh',
    [string]$PoTokenScope      = 'web.gvs'
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$msg) Write-Host "[bootstrap] $msg" -ForegroundColor Cyan }
function Write-Sub  { param([string]$msg) Write-Host "            $msg" }
function Throw-Err  { param([string]$msg) Write-Host "[bootstrap] ERROR: $msg" -ForegroundColor Red; exit 1 }

$ScriptDir    = $PSScriptRoot
$GeneratorDir = Join-Path $InstallDir 'generator'
$RefreshScript = Join-Path $InstallDir 'refresh-pot.ps1'
$EnvFile      = Join-Path $DataDir    'bridge.env'

Write-Step "configuration:"
Write-Sub  "AppDir       = $AppDir"
Write-Sub  "InstallDir   = $InstallDir"
Write-Sub  "GeneratorDir = $GeneratorDir"
Write-Sub  "DataDir      = $DataDir"
Write-Sub  "EnvFile      = $EnvFile"
Write-Sub  "Service      = $BridgeServiceName"
Write-Sub  "Task         = $TaskName"
Write-Host ""

# ---- preflight --------------------------------------------------------------
if (-not (Test-Path $InstallDir))   { Throw-Err "InstallDir not found: $InstallDir (run install.ps1 first)" }
if (-not (Test-Path $EnvFile))      { Throw-Err "EnvFile not found: $EnvFile" }
if (-not (Test-Path $ScriptDir))    { Throw-Err "ScriptDir not found: $ScriptDir" }
foreach ($f in @('package.json', 'generate-po-token.mjs', 'refresh-pot.ps1')) {
    if (-not (Test-Path (Join-Path $ScriptDir $f))) {
        Throw-Err "missing $f in $ScriptDir -- run `git pull` in $AppDir first"
    }
}

# ---- locate node ------------------------------------------------------------
$nodeDir = Join-Path $env:ProgramFiles 'nodejs'
if (Test-Path $nodeDir) { $env:PATH = "$nodeDir;$env:PATH" }
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Throw-Err "node.exe not on PATH" }
Write-Step ("node.exe = {0}  ({1})" -f $nodeCmd.Source, (& $nodeCmd.Source --version).Trim())

# ---- (re)deploy the generator -----------------------------------------------
Write-Step "redeploying generator to $GeneratorDir..."
if (-not (Test-Path $GeneratorDir)) {
    New-Item -ItemType Directory -Path $GeneratorDir -Force | Out-Null
}

# Wipe the entire generator dir so the broken youtube-po-token-generator
# install can't shadow ours. We re-copy + re-install from scratch.
Get-ChildItem -Path $GeneratorDir -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Copy-Item -Path (Join-Path $ScriptDir 'package.json')           -Destination (Join-Path $GeneratorDir 'package.json')          -Force
Copy-Item -Path (Join-Path $ScriptDir 'generate-po-token.mjs')  -Destination (Join-Path $GeneratorDir 'generate-po-token.mjs') -Force
Write-Sub "copied package.json + generate-po-token.mjs"

# Refresh refresh-pot.ps1 (it now invokes generate-po-token.mjs).
Copy-Item -Path (Join-Path $ScriptDir 'refresh-pot.ps1') -Destination $RefreshScript -Force
Write-Sub "copied refresh-pot.ps1 -> $RefreshScript"

# ---- npm install in the generator dir ---------------------------------------
Write-Step "installing generator deps (bgutils-js + jsdom)..."
Push-Location $GeneratorDir
try {
    & npm.cmd install --no-audit --no-fund --no-progress
    if ($LASTEXITCODE -ne 0) { Throw-Err "npm install failed (exit $LASTEXITCODE)" }
} finally { Pop-Location }

$bgPkg = Join-Path $GeneratorDir 'node_modules\bgutils-js\package.json'
$jsdomPkg = Join-Path $GeneratorDir 'node_modules\jsdom\package.json'
if (-not (Test-Path $bgPkg))    { Throw-Err "bgutils-js missing after npm install" }
if (-not (Test-Path $jsdomPkg)) { Throw-Err "jsdom missing after npm install" }
Write-Sub ("bgutils-js v" + ((Get-Content $bgPkg    | ConvertFrom-Json).version))
Write-Sub ("jsdom      v" + ((Get-Content $jsdomPkg | ConvertFrom-Json).version))

# ---- smoke-test the generator -----------------------------------------------
Write-Step "running generator (~5s)..."
$start = Get-Date
$rawLines = & $nodeCmd.Source (Join-Path $GeneratorDir 'generate-po-token.mjs') 2>&1
$elapsed = (Get-Date) - $start
$exit = $LASTEXITCODE
Write-Sub ("elapsed: {0:N0} ms, exit: {1}" -f $elapsed.TotalMilliseconds, $exit)

if ($exit -ne 0) {
    Write-Sub "--- raw generator output ---"
    $rawLines | ForEach-Object { Write-Host "    $_" }
    Throw-Err "generator failed (exit $exit)"
}

# stdout lines have the JSON; stderr lines have [generate-po-token] timing logs.
$jsonLine = $rawLines | Where-Object { $_ -is [string] -and $_ -match '^\s*\{.*"poToken"' } | Select-Object -Last 1
if (-not $jsonLine) {
    Write-Sub "--- raw generator output ---"
    $rawLines | ForEach-Object { Write-Host "    $_" }
    Throw-Err "generator did not emit a JSON line on stdout"
}

try { $parsed = $jsonLine | ConvertFrom-Json } catch { Throw-Err "JSON parse failed: $($_.Exception.Message)" }
$poToken     = $parsed.poToken
$visitorData = $parsed.visitorData
if ([string]::IsNullOrWhiteSpace($poToken))     { Throw-Err "poToken empty" }
if ([string]::IsNullOrWhiteSpace($visitorData)) { Throw-Err "visitorData empty" }
Write-Sub ("got pair: poToken {0} chars, visitorData {1} chars" -f $poToken.Length, $visitorData.Length)

# ---- atomically update bridge.env -------------------------------------------
Write-Step "updating $EnvFile..."
$envDir = Split-Path -Parent $EnvFile
$tmpFile = Join-Path $envDir ("bridge.env." + ([guid]::NewGuid().ToString('N')) + ".tmp")

$existing = Get-Content -Path $EnvFile -Encoding UTF8
$filtered = $existing | Where-Object { $_ -notmatch '^\s*YOUTUBE_(PO_TOKEN|VISITOR_DATA)\s*=' }
$newLines = @($filtered) + @(
    "YOUTUBE_PO_TOKEN=${PoTokenScope}+${poToken}",
    "YOUTUBE_VISITOR_DATA=${visitorData}"
)

Set-Content -Path $tmpFile -Value $newLines -Encoding UTF8
Move-Item -Path $tmpFile -Destination $EnvFile -Force
Write-Sub "wrote YOUTUBE_PO_TOKEN + YOUTUBE_VISITOR_DATA"

# ---- repair nssm AppParameters quoting (if needed) --------------------------
# The original install.ps1 registered AppParameters via `nssm install <svc> <exe> <args>`,
# which strips the inner double quotes around paths containing spaces. The service
# then tries to launch `powershell.exe -File C:\Program` (truncated at the first
# space in "C:\Program Files\SafeTube\start-bridge.ps1") and crash-loops every 5s.
# Detect and repair this from a single source of truth: nssm.
Write-Step "verifying nssm AppParameters quoting for $BridgeServiceName..."
$nssmCmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
if (-not $nssmCmd) {
    # Fall back to the well-known winget shim location.
    $wingetNssm = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\nssm.exe'
    if (Test-Path $wingetNssm) { $nssmCmd = @{ Source = $wingetNssm } } else { Throw-Err "nssm.exe not on PATH and not at $wingetNssm" }
}
$BridgeScript = Join-Path $InstallDir 'start-bridge.ps1'
$ServerDir    = Join-Path $AppDir     'server'
$expectedAppParams = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -EnvFile "{1}" -AppDir "{2}"' -f $BridgeScript, $EnvFile, $ServerDir
$currentAppParams  = (& $nssmCmd.Source get $BridgeServiceName AppParameters) -join ''
if ($currentAppParams -ne $expectedAppParams) {
    Write-Sub "AppParameters out-of-date or unquoted -- repairing"
    Stop-Service -Name $BridgeServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    & $nssmCmd.Source set $BridgeServiceName Application   'powershell.exe' | Out-Null
    & $nssmCmd.Source set $BridgeServiceName AppParameters $expectedAppParams | Out-Null
    & $nssmCmd.Source set $BridgeServiceName AppDirectory  $ServerDir | Out-Null
    Write-Sub "AppParameters reset (paths now quoted)"
} else {
    Write-Sub "AppParameters already correct"
}

# ---- restart the bridge -----------------------------------------------------
Write-Step "restarting service $BridgeServiceName..."
$svc = Get-Service -Name $BridgeServiceName -ErrorAction SilentlyContinue
if (-not $svc) { Throw-Err "service $BridgeServiceName not found" }
Restart-Service -Name $BridgeServiceName -Force
Start-Sleep -Seconds 4
$svc = Get-Service -Name $BridgeServiceName
Write-Sub ("service status: {0}" -f $svc.Status)

# Confirm something is actually listening on the bridge port. nssm reports the
# service as "Running" even when the child crash-loops, so this is the real
# liveness check.
$listener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    Write-Sub ("port 3001 listener: pid {0} on {1}" -f $listener.OwningProcess, $listener.LocalAddress)
} else {
    Write-Sub "WARN: nothing listening on port 3001 yet -- check $(Join-Path $DataDir 'logs\bridge.log')"
}

# ---- register the missing scheduled task ------------------------------------
Write-Step "ensuring scheduled task $TaskName exists (every 4h)..."
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Sub "removed pre-existing task"
}

$taskArg = ('-NoProfile -NonInteractive -ExecutionPolicy Bypass ' +
            '-File "{0}" -EnvFile "{1}" -GeneratorDir "{2}" -BridgeServiceName {3}' -f
            $RefreshScript, $EnvFile, $GeneratorDir, $BridgeServiceName)
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArg
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddHours(4)) `
                                    -RepetitionInterval (New-TimeSpan -Hours 4)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings | Out-Null
Write-Sub "task registered (first auto-run in 4h, then every 4h)"

# ---- summary ----------------------------------------------------------------
Write-Host ""
Write-Host "==============================================================" -ForegroundColor Green
Write-Host "  bootstrap-pot-fix.ps1: DONE." -ForegroundColor Green
Write-Host "==============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "What just happened:"
Write-Host "  * Wiped $GeneratorDir and reinstalled with bgutils-js + jsdom"
Write-Host "  * Generated PO token + visitor_data in $([int]$elapsed.TotalMilliseconds) ms"
Write-Host "  * Wrote them to $EnvFile (atomic rewrite)"
Write-Host "  * Restarted $BridgeServiceName"
Write-Host "  * Registered scheduled task $TaskName (every 4h)"
Write-Host ""
Write-Host "Tail bridge logs to confirm clean startup:"
Write-Host "  Get-Content '$(Join-Path $DataDir 'logs\bridge.log')' -Tail 50 -Wait"
Write-Host ""
Write-Host "Force the next rotation any time:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
