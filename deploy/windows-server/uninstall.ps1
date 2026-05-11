<#
.SYNOPSIS
    Removes everything install.ps1 created (service, task, scripts) -- but keeps
    C:\ProgramData\SafeTube\bridge.env and the log directory unless -Purge is passed.

.PARAMETER Purge
    Also delete C:\ProgramData\SafeTube (env file + logs).
#>

#Requires -Version 5.1
#Requires -RunAsAdministrator

param([switch]$Purge)

$ErrorActionPreference = 'Continue'

$ServiceName = 'SafeTubeBridge'
$TaskName    = 'SafeTube-PO-Token-Refresh'
$InstallDir  = Join-Path $env:ProgramFiles 'SafeTube'
$DataDir     = Join-Path $env:ProgramData 'SafeTube'

Write-Host "[uninstall] stopping + removing service $ServiceName..."
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $nssm = (Get-Command nssm.exe -ErrorAction SilentlyContinue).Source
    if ($nssm) {
        & $nssm remove $ServiceName confirm | Out-Null
    } else {
        & sc.exe delete $ServiceName | Out-Null
    }
}

Write-Host "[uninstall] removing scheduled task $TaskName..."
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Write-Host "[uninstall] removing install directory $InstallDir..."
if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir
}

if ($Purge) {
    Write-Host "[uninstall] -Purge: removing $DataDir (env file + logs)..."
    if (Test-Path $DataDir) {
        Remove-Item -Recurse -Force $DataDir
    }
} else {
    Write-Host "[uninstall] keeping $DataDir (env file + logs). Pass -Purge to remove."
}

Write-Host "[uninstall] done."
