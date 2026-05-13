<#
.SYNOPSIS
    Turn-key installer for the SafeTube Media Bridge on Windows Server.

.DESCRIPTION
    Run from an elevated PowerShell prompt:

        cd C:\path\to\kids-youtube-app
        powershell -ExecutionPolicy Bypass -File .\deploy\windows-server\install.ps1

    Auto-detects the app dir (= the parent of this script's parent). Installs nssm
    via winget if missing, runs npm install for the bridge and the PO-token generator,
    copies start-bridge.ps1 / refresh-pot.ps1 into C:\Program Files\SafeTube\, registers
    the SafeTubeBridge Windows service via nssm, and creates the SafeTube-PO-Token-Refresh
    scheduled task firing every 4 hours.

    Does NOT start the service -- the env file at C:\ProgramData\SafeTube\bridge.env
    needs FIXME values filled in first.
#>

#Requires -Version 5.1
#Requires -RunAsAdministrator

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$msg) Write-Host "[install] $msg" -ForegroundColor Cyan }
function Write-Sub  { param([string]$msg) Write-Host "          $msg" }
function Throw-Err  { param([string]$msg) Write-Host "[install] ERROR: $msg" -ForegroundColor Red; exit 1 }

# ---- preflight + path detection ---------------------------------------------
$ScriptDir = $PSScriptRoot
$AppDir    = Resolve-Path (Join-Path $ScriptDir '..\..')
$AppDir    = $AppDir.Path.TrimEnd('\')
$ServerDir = Join-Path $AppDir 'server'

if (-not (Test-Path (Join-Path $ServerDir 'index.js'))) {
    Throw-Err "did not find $ServerDir\index.js -- is this the right repo?"
}

$InstallDir   = Join-Path $env:ProgramFiles 'SafeTube'
$GeneratorDir = Join-Path $InstallDir 'generator'
$DataDir      = Join-Path $env:ProgramData 'SafeTube'
$LogDir       = Join-Path $DataDir 'logs'

$BridgeScript  = Join-Path $InstallDir 'start-bridge.ps1'
$RefreshScript = Join-Path $InstallDir 'refresh-pot.ps1'
$EnvFile       = Join-Path $DataDir 'bridge.env'

$ServiceName = 'SafeTubeBridge'
$TaskName    = 'SafeTube-PO-Token-Refresh'

Write-Step "configuration:"
Write-Sub  "AppDir        = $AppDir"
Write-Sub  "ServerDir     = $ServerDir"
Write-Sub  "InstallDir    = $InstallDir"
Write-Sub  "GeneratorDir  = $GeneratorDir"
Write-Sub  "DataDir       = $DataDir"
Write-Sub  "EnvFile       = $EnvFile"
Write-Sub  "ServiceName   = $ServiceName"
Write-Sub  "TaskName      = $TaskName"
Write-Host ""

# ---- verify Node.js ---------------------------------------------------------
Write-Step "verifying Node.js..."
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    foreach ($p in @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')
    )) {
        if ($p -and (Test-Path $p)) {
            $env:PATH = "$(Split-Path $p);$env:PATH"
            $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
            break
        }
    }
}
if (-not $nodeCmd) { Throw-Err "Node.js not found. Install Node 18+ from https://nodejs.org and retry." }
$nodeVersion = (& $nodeCmd.Source --version).Trim()
Write-Sub "node.exe = $($nodeCmd.Source)  ($nodeVersion)"

# ---- verify / install nssm --------------------------------------------------
Write-Step "verifying nssm..."
$nssmCmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
if (-not $nssmCmd) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Sub "nssm not on PATH, installing via winget..."
        & winget install --id NSSM.NSSM --silent --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -ne 0) {
            Write-Sub "winget install returned $LASTEXITCODE -- will check PATH anyway."
        }
        # Refresh PATH from machine + user scopes.
        $env:PATH = ([Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                     [Environment]::GetEnvironmentVariable('PATH', 'User'))
        $nssmCmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
    }
}
if (-not $nssmCmd) {
    Throw-Err "nssm not found. Install it manually from https://nssm.cc/download (unzip nssm.exe into a folder on PATH, e.g. C:\Windows\System32), then re-run install.ps1."
}
Write-Sub "nssm = $($nssmCmd.Source)"

# ---- create dirs ------------------------------------------------------------
Write-Step "creating directories..."
foreach ($d in @($InstallDir, $GeneratorDir, $DataDir, $LogDir)) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        Write-Sub "created $d"
    } else {
        Write-Sub "exists  $d"
    }
}

# ---- npm install (bridge) ---------------------------------------------------
Write-Step "installing bridge dependencies in $ServerDir..."
Push-Location $ServerDir
try {
    & npm.cmd install --omit=dev --no-audit --no-fund --no-progress
    if ($LASTEXITCODE -ne 0) { Throw-Err "npm install (bridge) failed with exit $LASTEXITCODE" }
} finally { Pop-Location }

# ---- npm install (generator) ------------------------------------------------
Write-Step "installing PO-token generator dependencies..."
Copy-Item -Path (Join-Path $ScriptDir 'package.json')           -Destination (Join-Path $GeneratorDir 'package.json')           -Force
Copy-Item -Path (Join-Path $ScriptDir 'generate-po-token.mjs')  -Destination (Join-Path $GeneratorDir 'generate-po-token.mjs')  -Force
Write-Sub "copied generate-po-token.mjs -> $GeneratorDir"

# Wipe any stale node_modules / lockfile from the previous (broken)
# youtube-po-token-generator install before npm install runs fresh.
$staleNm   = Join-Path $GeneratorDir 'node_modules'
$staleLock = Join-Path $GeneratorDir 'package-lock.json'
if (Test-Path $staleNm)   { Remove-Item $staleNm   -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $staleLock) { Remove-Item $staleLock -Force          -ErrorAction SilentlyContinue }

Push-Location $GeneratorDir
try {
    & npm.cmd install --no-audit --no-fund --no-progress
    if ($LASTEXITCODE -ne 0) { Throw-Err "npm install (generator) failed with exit $LASTEXITCODE" }
} finally { Pop-Location }

# ---- copy scripts -----------------------------------------------------------
Write-Step "copying scripts to $InstallDir..."
Copy-Item -Path (Join-Path $ScriptDir 'start-bridge.ps1')  -Destination $BridgeScript  -Force
Copy-Item -Path (Join-Path $ScriptDir 'refresh-pot.ps1')   -Destination $RefreshScript -Force
Write-Sub "copied start-bridge.ps1 -> $BridgeScript"
Write-Sub "copied refresh-pot.ps1  -> $RefreshScript"

# ---- env file ---------------------------------------------------------------
$envCreated = $false
if (-not (Test-Path $EnvFile)) {
    Write-Step "creating $EnvFile from template (FILL IN THE FIXME VALUES LATER)..."
    Copy-Item -Path (Join-Path $ScriptDir 'safetube-bridge.env.example') -Destination $EnvFile -Force
    $envCreated = $true
} else {
    Write-Step "env file already exists at $EnvFile -- leaving as-is."
}

# Restrict the env file to administrators (it'll hold secrets).
try {
    $acl = Get-Acl $EnvFile
    $acl.SetAccessRuleProtection($true, $false)
    $rules = @(
        New-Object System.Security.AccessControl.FileSystemAccessRule(
            'NT AUTHORITY\SYSTEM', 'FullControl', 'Allow'
        )
        New-Object System.Security.AccessControl.FileSystemAccessRule(
            'BUILTIN\Administrators', 'FullControl', 'Allow'
        )
    )
    foreach ($r in $rules) { $acl.AddAccessRule($r) }
    Set-Acl -Path $EnvFile -AclObject $acl
    Write-Sub "ACL restricted to SYSTEM + Administrators"
} catch {
    Write-Sub "WARN: couldn't tighten ACL on $EnvFile ($_)"
}

# ---- register Windows service via nssm --------------------------------------
Write-Step "registering Windows service $ServiceName via nssm..."
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Sub "service exists, stopping and removing first..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    & $nssmCmd.Source remove $ServiceName confirm | Out-Null
    Start-Sleep -Seconds 1
}

# nssm install + AppParameters in TWO steps. Doing them together in
# `nssm install <svc> <exe> <args>` makes nssm strip the inner double quotes
# around paths-with-spaces, so the service then tries to launch
# `powershell.exe -File C:\Program` and crash-loops every 5s. Setting
# AppParameters as a single pre-quoted string via `nssm set` preserves the
# inner double quotes so powershell.exe parses `-File "..."` correctly.
$psArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -EnvFile "{1}" -AppDir "{2}"' -f $BridgeScript, $EnvFile, $ServerDir

& $nssmCmd.Source install $ServiceName 'powershell.exe' | Out-Null
& $nssmCmd.Source set $ServiceName AppParameters      $psArgs    | Out-Null
& $nssmCmd.Source set $ServiceName AppDirectory       $ServerDir | Out-Null
& $nssmCmd.Source set $ServiceName DisplayName        "SafeTube Media Bridge" | Out-Null
& $nssmCmd.Source set $ServiceName Description        "Media bridge for SafeTube kids YouTube app (yt-dlp + Piped/Invidious fallback)" | Out-Null
& $nssmCmd.Source set $ServiceName Start              SERVICE_AUTO_START | Out-Null
& $nssmCmd.Source set $ServiceName AppStdout          (Join-Path $LogDir 'bridge.log') | Out-Null
& $nssmCmd.Source set $ServiceName AppStderr          (Join-Path $LogDir 'bridge.log') | Out-Null
& $nssmCmd.Source set $ServiceName AppRotateFiles     1 | Out-Null
& $nssmCmd.Source set $ServiceName AppRotateOnline    1 | Out-Null
& $nssmCmd.Source set $ServiceName AppRotateBytes     10485760 | Out-Null
& $nssmCmd.Source set $ServiceName AppExit            Default Restart | Out-Null
& $nssmCmd.Source set $ServiceName AppRestartDelay    5000 | Out-Null
Write-Sub "service registered (start mode: Automatic, restart on failure: 5s delay)"

# ---- register Task Scheduler entry ------------------------------------------
Write-Step "registering scheduled task $TaskName (every 4h)..."
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Sub "removed pre-existing task"
}

$taskArg = ('-NoProfile -NonInteractive -ExecutionPolicy Bypass ' +
            '-File "{0}" -EnvFile "{1}" -GeneratorDir "{2}" -BridgeServiceName {3}' -f
            $RefreshScript, $EnvFile, $GeneratorDir, $ServiceName)

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArg

# Time-based trigger: first fire in 5 minutes, then repeat every 4 hours forever.
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(5)) `
                                    -RepetitionInterval (New-TimeSpan -Hours 4)

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' `
                                        -LogonType ServiceAccount `
                                        -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Write-Sub "task registered (first run in ~5 min, then every 4h)"

# ---- summary ----------------------------------------------------------------
Write-Host ""
Write-Host "==============================================================" -ForegroundColor Green
Write-Host "  install.ps1: DONE." -ForegroundColor Green
Write-Host "==============================================================" -ForegroundColor Green
Write-Host ""

if ($envCreated) {
    Write-Host "The env file was just created from the template. EDIT IT before starting:"
    Write-Host ""
    Write-Host "  notepad $EnvFile"
    Write-Host ""
    Write-Host "Fill in every line that says FIXME:"
    Write-Host "  - PUBLIC_BASE_URL          (your Cloudflare Tunnel URL, no trailing slash)"
    Write-Host "  - SUPABASE_URL             (https://YOUR_PROJECT_REF.supabase.co)"
    Write-Host "  - SUPABASE_ANON_KEY"
    Write-Host "  - MEDIA_BRIDGE_GRANT_SECRET    (generate any 64-char random string)"
    Write-Host "  - MEDIA_BRIDGE_CORS_ORIGINS    (your Vercel domain(s))"
    Write-Host ""
    Write-Host "Leave YOUTUBE_PO_TOKEN= and YOUTUBE_VISITOR_DATA= empty -- the task fills them."
    Write-Host ""
}

Write-Host "Then go live with these four commands (admin PowerShell):"
Write-Host ""
Write-Host "  Start-Service $ServiceName"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'      # fire the first rotation NOW"
Write-Host "  Get-Content '$LogDir\bridge.log' -Tail 50 -Wait"
Write-Host ""
Write-Host "Useful commands later:"
Write-Host "  Restart-Service $ServiceName                          # after editing env"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'             # force token rotation"
Write-Host "  Get-ScheduledTaskInfo -TaskName '$TaskName'           # last/next run + result"
Write-Host "  Get-Content '$LogDir\bridge.log' -Tail 50 -Wait       # tail bridge logs"
Write-Host ""
Write-Host "To remove everything: powershell -File .\deploy\windows-server\uninstall.ps1"
