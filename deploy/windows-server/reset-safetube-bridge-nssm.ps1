#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Force-reset SafeTubeBridge when stuck (SERVICE_PAUSED / marked for deletion).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\windows-server\reset-safetube-bridge-nssm.ps1

  Or double-click: reset-safetube-bridge-nssm-admin.cmd (requests UAC)
#>

$ErrorActionPreference = 'Stop'

$ServiceName = 'SafeTubeBridge'
$NodeExe     = 'C:\Program Files\nodejs\node.exe'
$AppParams   = 'index.cjs'
$AppDir      = 'C:\Users\eladtheking1010\kids-youtube-app\server'
$LogDir      = 'C:\ProgramData\SafeTube\logs'
$BridgeLog   = Join-Path $LogDir 'bridge.log'
$MaxAttempts = 8

function Write-Step { param([string]$m) Write-Host "[reset-bridge] $m" -ForegroundColor Cyan }
function Write-Ok   { param([string]$m) Write-Host "[reset-bridge] $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "[reset-bridge] $m" -ForegroundColor Yellow }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warn 'Not running as Administrator - relaunching with UAC...'
    $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    Start-Process powershell.exe -Verb RunAs -ArgumentList $arg -Wait
    exit $LASTEXITCODE
}

$nssm = Get-Command nssm.exe -ErrorAction SilentlyContinue
if (-not $nssm) {
    $wingetNssm = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\nssm.exe'
    if (Test-Path $wingetNssm) { $nssm = @{ Source = $wingetNssm } }
}
if (-not $nssm) { throw 'nssm.exe not found. Install: winget install NSSM.NSSM' }
$nssmExe = $nssm.Source

if (-not (Test-Path $NodeExe)) { throw "node.exe not found: $NodeExe" }
if (-not (Test-Path (Join-Path $AppDir 'index.cjs'))) {
    throw "index.cjs not found in $AppDir"
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Stop-BridgeLockingProcesses {
    Write-Step 'Stopping service + killing locking processes...'

    & $nssmExe continue $ServiceName 2>$null | Out-Null
    sc.exe continue $ServiceName 2>$null | Out-Null
    & $nssmExe stop $ServiceName 2>$null | Out-Null
    sc.exe stop $ServiceName 2>$null | Out-Null
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    foreach ($name in @('node', 'nssm')) {
        Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
                if ($cmd -and (
                        $cmd -like "*$AppDir*" -or
                        $cmd -like '*index.cjs*' -or
                        $cmd -like '*SafeTubeBridge*' -or
                        $name -eq 'nssm'
                    )) {
                    Write-Warn "Stop-Process $($name) PID $($_.Id)"
                    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
                }
            } catch { }
        }
    }

    taskkill.exe /F /IM nssm.exe /T 2>$null | Out-Null

    Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            if ($_.OwningProcess) {
                Write-Warn "taskkill port 3001 PID $($_.OwningProcess)"
                Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
            }
        }

    Start-Sleep -Seconds 2
}

function Remove-BridgeServiceFully {
    Write-Step 'Removing service (nssm remove + sc delete)...'
    & $nssmExe remove $ServiceName confirm 2>$null | Out-Null
    sc.exe delete $ServiceName 2>$null | Out-Null

    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if (-not $svc) { return $true }
        Write-Warn "Service still registered (Status=$($svc.Status)) - sc delete again..."
        sc.exe delete $ServiceName 2>$null | Out-Null
        Start-Sleep -Seconds 4
    }
    return -not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)
}

function Install-BridgeService {
    Write-Step 'Installing SafeTubeBridge...'
    & $nssmExe install $ServiceName $NodeExe | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "nssm install failed (exit $LASTEXITCODE). Service may still be marked for deletion." }

    & $nssmExe set $ServiceName AppParameters $AppParams | Out-Null
    & $nssmExe set $ServiceName AppDirectory  $AppDir | Out-Null
    & $nssmExe set $ServiceName DisplayName  'SafeTube Media Bridge' | Out-Null
    & $nssmExe set $ServiceName Description  'SafeTube bridge (node index.cjs)' | Out-Null
    & $nssmExe set $ServiceName Start        SERVICE_AUTO_START | Out-Null
    sc.exe config $ServiceName start= auto | Out-Null
    & $nssmExe set $ServiceName AppStdout    $BridgeLog | Out-Null
    & $nssmExe set $ServiceName AppStderr    $BridgeLog | Out-Null
    & $nssmExe set $ServiceName AppRotateFiles  1 | Out-Null
    & $nssmExe set $ServiceName AppRotateBytes  10485760 | Out-Null
    & $nssmExe set $ServiceName AppExit Default Restart | Out-Null
    & $nssmExe set $ServiceName AppRestartDelay 5000 | Out-Null
}

function Start-BridgeServiceVerified {
    Write-Step 'Starting service...'
    & $nssmExe start $ServiceName 2>&1 | Out-String | Write-Host
    Start-Sleep -Seconds 5

    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $svc) { return $false }

    if ($svc.Status -eq 'Paused') {
        Write-Warn 'Status Paused - nssm continue + sc continue...'
        & $nssmExe continue $ServiceName 2>$null | Out-Null
        sc.exe continue $ServiceName 2>$null | Out-Null
        Start-Sleep -Seconds 3
        $svc = Get-Service -Name $ServiceName
    }

    return ($svc.Status -eq 'Running')
}

for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    Write-Step "=== Attempt $attempt / $MaxAttempts ==="

    Stop-BridgeLockingProcesses

    $gone = Remove-BridgeServiceFully
    if (-not $gone) {
        Write-Warn 'Still marked for deletion - close services.msc if open, killing processes, retrying...'
        taskkill.exe /F /IM nssm.exe /T 2>$null | Out-Null
        Start-Sleep -Seconds 5
        continue
    }

    Start-Sleep -Seconds 2

    try {
        Install-BridgeService
    } catch {
        Write-Warn $_.Exception.Message
        Start-Sleep -Seconds 5
        continue
    }

    if (Start-BridgeServiceVerified) {
        $svc = Get-Service -Name $ServiceName
        Write-Ok "Status: $($svc.Status) (StartType: $($svc.StartType))"
        Write-Ok "Application:   $(& $nssmExe get $ServiceName Application)"
        Write-Ok "AppParameters: $(& $nssmExe get $ServiceName AppParameters)"
        Write-Ok "AppDirectory:  $(& $nssmExe get $ServiceName AppDirectory)"
        if (Test-Path $BridgeLog) {
            Write-Step 'Last log lines:'
            Get-Content $BridgeLog -Tail 15
        }
        Write-Ok 'Done - SafeTubeBridge is Running.'
        exit 0
    }

    Write-Warn "Not Running after attempt $attempt - retrying..."
    Start-Sleep -Seconds 5
}

Write-Warn @'
Failed after all attempts.
  1. Close services.msc (Services console) if it is open.
  2. Reboot the server.
  3. Run this script again as Administrator.
'@
exit 1
