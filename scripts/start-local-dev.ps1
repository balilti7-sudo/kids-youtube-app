# Start local Media Bridge (8787) + remind to run Vite separately.
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Server = Join-Path $Root 'server'
$CookiesSrc = Join-Path $Server 'www.youtube.com_cookies .txt'
$CookiesDst = Join-Path $Server 'cookies.txt'

if (Test-Path $CookiesSrc) {
  Copy-Item -Force $CookiesSrc $CookiesDst
}

Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

$env:PORT = '8787'
$env:HOST = '0.0.0.0'
$env:COOKIES_FILE = './cookies.txt'
$env:YT_DLP_COOKIES_FILE = './cookies.txt'
$env:POT_URL = 'http://127.0.0.1:26148'
$env:PUBLIC_BRIDGE_ORIGIN = 'http://localhost:5174'

Set-Location $Server
Write-Host '[local-dev] Starting bridge on http://127.0.0.1:8787 ...' -ForegroundColor Cyan
Write-Host '[local-dev] In another terminal: npm run dev  (frontend http://localhost:5174)' -ForegroundColor Yellow
node index.cjs
