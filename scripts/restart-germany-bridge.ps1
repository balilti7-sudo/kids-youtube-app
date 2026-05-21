# Restart Media Bridge on port 3001 (Germany host) without full nssm deploy.
# Loads C:\ProgramData\SafeTube\bridge.env when readable; merges server/.env and .env.local.
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$ServerDir = Join-Path $Root 'server'
$CookiesSrc = Join-Path $ServerDir 'www.youtube.com_cookies .txt'
$CookiesDst = Join-Path $ServerDir 'cookies.txt'
$BridgeEnv = 'C:\ProgramData\SafeTube\bridge.env'
$LogDir = Join-Path $ServerDir 'logs'
$OutLog = Join-Path $LogDir 'bridge.out.log'
$ErrLog = Join-Path $LogDir 'bridge.err.log'

function Write-Step { param([string]$m) Write-Host "[restart-bridge] $m" -ForegroundColor Cyan }
function Write-Ok { param([string]$m) Write-Host "[restart-bridge] $m" -ForegroundColor Green }

function Import-DotEnvFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }
    try {
        $null = Get-Content -LiteralPath $Path -Encoding UTF8 -TotalCount 1 -ErrorAction Stop
    } catch {
        Write-Warning "Skip env file (no read access): $Path"
        return
    }
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ($line -match '^\s*(#|$)') { continue }
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
            $name = $Matches[1]
            $value = $Matches[2]
            if (($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) -or
                ($value.StartsWith("'") -and $value.EndsWith("'") -and $value.Length -ge 2)) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                [Environment]::SetEnvironmentVariable($name, $value, 'Process')
            }
        }
    }
}

function Map-ViteToBridgeEnv {
    $map = @{
        VITE_SUPABASE_URL      = 'SUPABASE_URL'
        VITE_SUPABASE_ANON_KEY = 'SUPABASE_ANON_KEY'
        VITE_MEDIA_BRIDGE_WELCOME_KEY = 'MEDIA_BRIDGE_WELCOME_KEY'
    }
    foreach ($kv in $map.GetEnumerator()) {
        $v = [Environment]::GetEnvironmentVariable($kv.Key, 'Process')
        if ($v -and -not [Environment]::GetEnvironmentVariable($kv.Value, 'Process')) {
            [Environment]::SetEnvironmentVariable($kv.Value, $v, 'Process')
        }
    }
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Write-Step 'Stopping listeners on port 3001'
Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
        if ($_.OwningProcess) {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
Start-Sleep -Seconds 2

if (Test-Path $CookiesSrc) {
    Copy-Item -Force $CookiesSrc $CookiesDst
    Write-Ok 'cookies synced'
}

Write-Step 'Loading environment'
@($BridgeEnv, (Join-Path $ServerDir '.env'), (Join-Path $Root '.env'), (Join-Path $Root '.env.local')) |
    ForEach-Object { Import-DotEnvFile $_ }
Map-ViteToBridgeEnv

# Production Germany bridge always listens on 3001 (server/.env may set 8787 for local Vite proxy).
[Environment]::SetEnvironmentVariable('PORT', '3001', 'Process')
[Environment]::SetEnvironmentVariable('HOST', '0.0.0.0', 'Process')
if (-not [Environment]::GetEnvironmentVariable('POT_URL', 'Process')) {
    [Environment]::SetEnvironmentVariable('POT_URL', 'http://127.0.0.1:26148', 'Process')
}

$missing = @()
foreach ($key in @('RESEND_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MEDIA_BRIDGE_WELCOME_KEY')) {
    if (-not [Environment]::GetEnvironmentVariable($key, 'Process')) { $missing += $key }
}
if ($missing.Count -gt 0) {
    Write-Warning "Missing env (pin-reset email may fail): $($missing -join ', ')"
    Write-Warning 'Run deploy-germany-bridge-admin.cmd as Administrator to load C:\ProgramData\SafeTube\bridge.env'
}

Write-Step 'npm install in server/'
Push-Location $ServerDir
& npm install --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install failed ($LASTEXITCODE)" }
Pop-Location

$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }

Write-Step "Starting bridge ($node index.cjs) -> logs in $LogDir"
$startArgs = @{
    FilePath     = $node
    ArgumentList = 'index.cjs'
    WorkingDirectory = $ServerDir
    WindowStyle  = 'Hidden'
    RedirectStandardOutput = $OutLog
    RedirectStandardError  = $ErrLog
}
Start-Process @startArgs | Out-Null

Start-Sleep -Seconds 5
$health = Invoke-RestMethod 'http://127.0.0.1:3001/health' -TimeoutSec 15
Write-Ok "health ok port=$($health.bridge.port)"

Start-Sleep -Seconds 2
$pinResetCode = curl.exe -s -o NUL -w '%{http_code}' -X POST `
    -H 'Content-Type: application/json' `
    -d '{}' `
    'http://127.0.0.1:3001/api/email/pin-reset-request'
if ($pinResetCode -eq '404') {
    throw 'POST /api/email/pin-reset-request returned 404 - email routes not mounted'
}
Write-Ok "POST /api/email/pin-reset-request -> HTTP $pinResetCode (401/400/503 expected without full body)"

Write-Ok 'Germany Media Bridge restarted on http://127.0.0.1:3001'
