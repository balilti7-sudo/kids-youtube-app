# scripts/check-health.ps1
# Quick triage. Run from the VPS (and also from your phone's browser using
# the public URL) to pinpoint where the chain is broken.

[CmdletBinding()]
param(
    [int]    $BridgePort = 3001,
    [int]    $PotPort    = 4416,
    [string] $PublicHost = '176.9.82.81'
)

function Test-Endpoint($url, $label) {
    Write-Host "→ $label ($url)" -ForegroundColor Cyan
    try {
        $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 8
        Write-Host "  OK $($r.StatusCode)" -ForegroundColor Green
        if ($r.Content) { Write-Host "  $($r.Content.Substring(0, [Math]::Min(200, $r.Content.Length)))" }
    } catch {
        Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n=== Services ===" -ForegroundColor Yellow
Get-Service SafeTubeBridge, SafeTubeBgutilPot -ErrorAction SilentlyContinue |
    Format-Table Name, Status, StartType

Write-Host "`n=== Listening sockets ===" -ForegroundColor Yellow
Get-NetTCPConnection -State Listen -LocalPort $BridgePort, $PotPort -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, State, OwningProcess |
    Format-Table -AutoSize
Write-Host "  (Bridge MUST show LocalAddress 0.0.0.0 — NOT 127.0.0.1 — to be reachable externally.)"

Write-Host "`n=== Firewall rule ===" -ForegroundColor Yellow
Get-NetFirewallRule -DisplayName 'SafeTube Bridge' -ErrorAction SilentlyContinue |
    Format-Table DisplayName, Enabled, Direction, Action

Write-Host "`n=== Endpoint checks ===" -ForegroundColor Yellow
Test-Endpoint "http://127.0.0.1:$PotPort/ping"        'POT (loopback)'
Test-Endpoint "http://127.0.0.1:$BridgePort/health"   'Bridge (loopback)'
Test-Endpoint "http://$PublicHost`:$BridgePort/health" 'Bridge (public IP)'

Write-Host "`n=== Tail of bridge log ===" -ForegroundColor Yellow
$log = 'C:\SafeTube\bridge\logs\bridge.out.log'
if (Test-Path $log) { Get-Content $log -Tail 30 } else { Write-Host "  $log not found" }
