#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Load C:\ProgramData\SafeTube\bridge.env into nssm AppEnvironmentExtra for SafeTubeBridge.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\windows-server\apply-bridge-env-nssm.ps1
#>

$ErrorActionPreference = 'Stop'

$ServiceName = 'SafeTubeBridge'
$EnvFile     = 'C:\ProgramData\SafeTube\bridge.env'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    Start-Process powershell.exe -Verb RunAs -ArgumentList $arg -Wait
    exit $LASTEXITCODE
}

$nssm = Get-Command nssm.exe -ErrorAction SilentlyContinue
if (-not $nssm) {
    $wingetNssm = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\nssm.exe'
    if (Test-Path $wingetNssm) { $nssm = @{ Source = $wingetNssm } }
}
if (-not $nssm) { throw 'nssm.exe not found' }

if (-not (Test-Path $EnvFile)) { throw "Env file not found: $EnvFile" }

$pairs = [System.Collections.Generic.List[string]]::new()
foreach ($line in (Get-Content -Path $EnvFile -Encoding UTF8)) {
    if ($line -match '^\s*(#|$)') { continue }
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
        $name  = $Matches[1]
        $value = $Matches[2]
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        if ($value -match '^(YOUR_|FIXME|re_YOUR)') { continue }
        $pairs.Add("${name}=${value}")
    }
}

$hasPotUrl = $pairs | Where-Object { $_ -like 'POT_URL=*' }
$potProvider = $pairs | Where-Object { $_ -like 'POT_PROVIDER_URL=*' } | Select-Object -First 1
if (-not $hasPotUrl -and $potProvider) {
    $val = ($potProvider -split '=', 2)[1]
    $pairs.Add("POT_URL=$val")
    Write-Host '[apply-bridge-env] added POT_URL from POT_PROVIDER_URL' -ForegroundColor Yellow
}

if ($pairs.Count -eq 0) { throw 'No KEY=VALUE lines found in bridge.env' }

$envBlock = ($pairs -join "`r`n")

Write-Host "[apply-bridge-env] $($pairs.Count) vars from $EnvFile" -ForegroundColor Cyan
& $nssm.Source set $ServiceName AppEnvironmentExtra $envBlock | Out-Null
if ($LASTEXITCODE -ne 0) { throw "nssm set AppEnvironmentExtra failed (exit $LASTEXITCODE)" }

Write-Host '[apply-bridge-env] OK - restart SafeTubeBridge to apply' -ForegroundColor Green
