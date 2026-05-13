<#
.SYNOPSIS
    Starts bgutil-pot HTTP server in the background (no nssm) — dev / quick test.

.EXAMPLE
    .\deploy\windows-server\start-bgutil-pot-background.ps1 -BgutilPotExe 'C:\tools\bgutil-pot.exe'
#>

#Requires -Version 5.1

param(
    [Parameter(Mandatory = $true)]
    [string]$BgutilPotExe,
    [string]$ListenHost = '127.0.0.1',
    [int]$Port = 4416
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $BgutilPotExe)) { throw "Not found: $BgutilPotExe" }

$log = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'SafeTube-bgutil-pot.log'
Start-Process -FilePath $BgutilPotExe -ArgumentList @('server', '--host', $ListenHost, '--port', "$Port") `
    -WorkingDirectory (Split-Path -Parent $BgutilPotExe) `
    -WindowStyle Hidden `
    -RedirectStandardOutput $log `
    -RedirectStandardError $log

Write-Host "Started bgutil-pot (PID detached). Logs: $log" -ForegroundColor Green
Write-Host "Ping: http://${ListenHost}:$Port/ping" -ForegroundColor Cyan
