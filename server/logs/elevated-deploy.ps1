$ErrorActionPreference = "Stop"
$log = "' + $log + '"
function Log($m) { $m | Out-File $log -Append -Encoding utf8; Write-Host $m }
try {
  Log "started"
  $conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conn) {
    if ($c.OwningProcess) { Log "stop PID $($c.OwningProcess)"; Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep 2
  & "c:\Users\eladtheking1010\kids-youtube-app\deploy\windows-server\deploy-germany-bridge.ps1" *>&1 | Out-File $log -Append -Encoding utf8
  Log "deploy exit=$LASTEXITCODE"
} catch { Log "ERR: $_"; exit 1 }
