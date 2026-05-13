<#
.SYNOPSIS
    Registers the Rust bgutil POT HTTP server as a Windows service (nssm), default port 4416.

.DESCRIPTION
    Download a release binary from https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases
    (e.g. bgutil-pot-windows-x86_64.exe), rename to bgutil-pot.exe, pass -BgutilPotExe.

    yt-dlp needs the Python plugin zip from the same release in server\yt-dlp-plugins\ (see server README).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\deploy\windows-server\install-bgutil-pot-nssm.ps1 `
      -BgutilPotExe 'C:\Program Files\SafeTube\bgutil-pot.exe'
#>

#Requires -Version 5.1
#Requires -RunAsAdministrator

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BgutilPotExe,
    [string]$ServiceName = 'SafeTubeBgutilPot',
    [string]$ListenHost = '127.0.0.1',
    [int]$Port = 4416,
    [string]$LogDir = (Join-Path $env:ProgramData 'SafeTube\logs')
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$m) Write-Host "[bgutil-pot] $m" -ForegroundColor Cyan }

if (-not (Test-Path -LiteralPath $BgutilPotExe)) {
    throw "Binary not found: $BgutilPotExe"
}

$nssmExe = $null
$cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
if ($cmd) {
    $nssmExe = $cmd.Source
} else {
    $wingetNssm = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\nssm.exe'
    if (Test-Path -LiteralPath $wingetNssm) { $nssmExe = $wingetNssm }
}
if (-not $nssmExe) {
    throw 'nssm.exe not on PATH. Install: winget install NSSM.NSSM'
}

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$logFile = Join-Path $LogDir 'bgutil-pot.log'
$binDir = Split-Path -Parent $BgutilPotExe

$appParams = "server --host $ListenHost --port $Port"

Write-Step "registering service $ServiceName..."
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    & $nssmExe remove $ServiceName confirm | Out-Null
    Start-Sleep -Seconds 1
}

& $nssmExe install $ServiceName $BgutilPotExe | Out-Null
& $nssmExe set $ServiceName AppParameters $appParams | Out-Null
& $nssmExe set $ServiceName AppDirectory $binDir | Out-Null
& $nssmExe set $ServiceName DisplayName 'SafeTube bgutil POT provider' | Out-Null
& $nssmExe set $ServiceName Description 'Proof-of-origin token HTTP server for yt-dlp (bgutil-pot)' | Out-Null
& $nssmExe set $ServiceName Start SERVICE_AUTO_START | Out-Null
& $nssmExe set $ServiceName AppStdout $logFile | Out-Null
& $nssmExe set $ServiceName AppStderr $logFile | Out-Null
& $nssmExe set $ServiceName AppRotateFiles 1 | Out-Null
& $nssmExe set $ServiceName AppRotateOnline 1 | Out-Null
& $nssmExe set $ServiceName AppRotateBytes 10485760 | Out-Null
& $nssmExe set $ServiceName AppExit Default Restart | Out-Null
& $nssmExe set $ServiceName AppRestartDelay 5000 | Out-Null

Write-Step "starting $ServiceName..."
Start-Service -Name $ServiceName
Write-Step "done. Test:  Invoke-WebRequest http://${ListenHost}:$Port/ping -UseBasicParsing"
