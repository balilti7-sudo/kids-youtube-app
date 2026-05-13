# scripts/install-services.ps1
# Run as Administrator. Re-installs SafeTubeBgutilPot + SafeTubeBridge as NSSM
# services, ensures Windows Firewall lets 3001 through, and verifies health.
#
# Adjust the four $Paths variables to match your VPS layout.

[CmdletBinding()]
param(
    [string]$NssmExe       = 'C:\nssm\nssm.exe',
    [string]$BgutilPotExe  = 'C:\SafeTube\pot\bgutil-pot.exe',
    [string]$BridgeRoot    = 'C:\SafeTube\bridge',
    [string]$NodeExe       = 'C:\Program Files\nodejs\node.exe',
    [string]$YtDlpExe      = 'C:\SafeTube\bin\yt-dlp.exe',
    [int]   $BridgePort    = 3001,
    [int]   $PotPort       = 4416
)

$ErrorActionPreference = 'Stop'

function Assert-Path($p, $label) {
    if (-not (Test-Path $p)) { throw "$label not found: $p" }
}

Assert-Path $NssmExe       'nssm.exe'
Assert-Path $BgutilPotExe  'bgutil-pot.exe'
Assert-Path $NodeExe       'node.exe'
Assert-Path $YtDlpExe      'yt-dlp.exe'
Assert-Path (Join-Path $BridgeRoot 'server\index.js') 'bridge index.js'

# ─── Stop + remove existing services so we re-create them cleanly ────────────
foreach ($svc in 'SafeTubeBridge', 'SafeTubeBgutilPot') {
    if (Get-Service -Name $svc -ErrorAction SilentlyContinue) {
        Write-Host "Stopping $svc…" -ForegroundColor Yellow
        & $NssmExe stop   $svc | Out-Null
        & $NssmExe remove $svc confirm | Out-Null
    }
}

# ─── 1. POT provider service ─────────────────────────────────────────────────
Write-Host "Installing SafeTubeBgutilPot on :$PotPort…" -ForegroundColor Cyan
& $NssmExe install SafeTubeBgutilPot $BgutilPotExe
& $NssmExe set SafeTubeBgutilPot AppParameters "--port $PotPort --host 127.0.0.1"
& $NssmExe set SafeTubeBgutilPot AppDirectory  (Split-Path $BgutilPotExe)
& $NssmExe set SafeTubeBgutilPot AppStdout     "$BridgeRoot\logs\pot.out.log"
& $NssmExe set SafeTubeBgutilPot AppStderr     "$BridgeRoot\logs\pot.err.log"
& $NssmExe set SafeTubeBgutilPot AppRotateFiles 1
& $NssmExe set SafeTubeBgutilPot AppRotateBytes 5242880
& $NssmExe set SafeTubeBgutilPot Start SERVICE_AUTO_START

# ─── 2. Bridge service ───────────────────────────────────────────────────────
Write-Host "Installing SafeTubeBridge on :$BridgePort…" -ForegroundColor Cyan
& $NssmExe install SafeTubeBridge $NodeExe "$BridgeRoot\server\index.js"
& $NssmExe set SafeTubeBridge AppDirectory $BridgeRoot
& $NssmExe set SafeTubeBridge AppEnvironmentExtra `
    "PORT=$BridgePort" `
    "HOST=0.0.0.0" `
    "POT_PROVIDER_URL=http://127.0.0.1:$PotPort" `
    "YT_DLP_PATH=$YtDlpExe" `
    "YT_CLIENT_CHAIN=web_embedded,tv,web_safari" `
    "NODE_ENV=production"
& $NssmExe set SafeTubeBridge AppStdout "$BridgeRoot\logs\bridge.out.log"
& $NssmExe set SafeTubeBridge AppStderr "$BridgeRoot\logs\bridge.err.log"
& $NssmExe set SafeTubeBridge AppRotateFiles 1
& $NssmExe set SafeTubeBridge AppRotateBytes 5242880
& $NssmExe set SafeTubeBridge Start SERVICE_AUTO_START
& $NssmExe set SafeTubeBridge DependOnService SafeTubeBgutilPot

# logs dir
New-Item -ItemType Directory -Force -Path (Join-Path $BridgeRoot 'logs') | Out-Null

# ─── 3. Firewall ─────────────────────────────────────────────────────────────
Write-Host "Opening Windows Firewall for TCP :$BridgePort…" -ForegroundColor Cyan
Get-NetFirewallRule -DisplayName 'SafeTube Bridge' -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
New-NetFirewallRule `
    -DisplayName 'SafeTube Bridge' `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $BridgePort `
    -Profile Any | Out-Null

# POT is loopback-only — do NOT open 4416 to the world.

# ─── 4. Start ────────────────────────────────────────────────────────────────
Write-Host "Starting services…" -ForegroundColor Cyan
& $NssmExe start SafeTubeBgutilPot
Start-Sleep -Seconds 2
& $NssmExe start SafeTubeBridge
Start-Sleep -Seconds 3

# ─── 5. Verify ───────────────────────────────────────────────────────────────
Write-Host "`n--- Health checks ---" -ForegroundColor Green
try {
    $pot = Invoke-WebRequest "http://127.0.0.1:$PotPort/ping" -UseBasicParsing -TimeoutSec 5
    Write-Host "POT  /ping   : $($pot.StatusCode)" -ForegroundColor Green
} catch { Write-Host "POT  /ping   : FAILED ($($_.Exception.Message))" -ForegroundColor Red }

try {
    $bridge = Invoke-WebRequest "http://127.0.0.1:$BridgePort/health" -UseBasicParsing -TimeoutSec 5
    Write-Host "Bridge /health (loopback): $($bridge.StatusCode)" -ForegroundColor Green
    Write-Host $bridge.Content
} catch { Write-Host "Bridge /health (loopback): FAILED ($($_.Exception.Message))" -ForegroundColor Red }

$ip = (Invoke-WebRequest 'https://api.ipify.org' -UseBasicParsing -TimeoutSec 5).Content.Trim()
Write-Host "`nFrom outside, the bridge should respond at:" -ForegroundColor Yellow
Write-Host "  http://$ip`:$BridgePort/health"
Write-Host "  http://www.box.co.il:$BridgePort/health   (if DNS already points here)"
