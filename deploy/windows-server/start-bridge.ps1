<#
.SYNOPSIS
    Service entry point for SafeTubeBridge -- loads the env file and runs `node index.js`.

.DESCRIPTION
    Registered by install.ps1 as the command line for the SafeTubeBridge Windows service
    (via nssm). nssm runs powershell.exe, which runs this script, which loads every
    KEY=VALUE from the env file into process env, then execs node from the bridge dir.

    When node exits (crash or graceful), this script exits with node's exit code, and nssm
    restarts the whole thing per AppExit=Restart with a 5s delay.

.PARAMETER EnvFile
    Path to the env file. Default: C:\ProgramData\SafeTube\bridge.env

.PARAMETER AppDir
    Path to the bridge's `server/` dir (contains index.js). Required.

.PARAMETER NodeExe
    Optional override for node.exe. If unset, the first `node.exe` on PATH wins,
    falling back to C:\Program Files\nodejs\node.exe.
#>

#Requires -Version 5.1

param(
    [string]$EnvFile = 'C:\ProgramData\SafeTube\bridge.env',
    [Parameter(Mandatory = $true)]
    [string]$AppDir,
    [string]$NodeExe
)

$ErrorActionPreference = 'Stop'

function Write-Status { param([string]$msg) Write-Host "[start-bridge] $msg" }

# ---- locate node.exe --------------------------------------------------------
if (-not $NodeExe) {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) {
        $NodeExe = $cmd.Source
    } else {
        foreach ($p in @(
            (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')
        )) {
            if ($p -and (Test-Path $p)) { $NodeExe = $p; break }
        }
    }
}
if (-not $NodeExe -or -not (Test-Path $NodeExe)) {
    throw "node.exe not found. Install Node 18+ from https://nodejs.org or pass -NodeExe."
}

# ---- load env file ----------------------------------------------------------
if (Test-Path $EnvFile) {
    Write-Status "loading env from $EnvFile"
    $loaded = 0
    foreach ($line in (Get-Content -Path $EnvFile -Encoding UTF8)) {
        # Skip blanks and comments.
        if ($line -match '^\s*(#|$)') { continue }
        # KEY=VALUE (greedy on value, max split into 2).
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
            $name  = $Matches[1]
            $value = $Matches[2]
            # Strip surrounding quotes if present.
            if (($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) -or
                ($value.StartsWith("'") -and $value.EndsWith("'") -and $value.Length -ge 2)) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
            $loaded++
        }
    }
    Write-Status "loaded $loaded env vars"
} else {
    Write-Status "WARNING: env file not found at $EnvFile -- bridge will start with empty env"
}

# ---- exec node --------------------------------------------------------------
$IndexJs = Join-Path $AppDir 'index.js'
if (-not (Test-Path $IndexJs)) { throw "$IndexJs not found -- wrong -AppDir?" }

Set-Location $AppDir
Write-Status "exec: `"$NodeExe`" `"$IndexJs`" (cwd=$AppDir)"

# Run node in the foreground so nssm sees the same process lifecycle as node itself.
# When node exits, PowerShell exits with the same code, and nssm restarts on non-zero.
& $NodeExe $IndexJs
exit $LASTEXITCODE
