# One-shot: build, commit kid-only channel search layout, push main, wait for Vercel production.
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

Write-Host '=== 1/4 Local production build ===' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed ($LASTEXITCODE)" }
Write-Host 'OK: build passed' -ForegroundColor Green

Write-Host ''
Write-Host '=== 2/4 Stage and commit (if needed) ===' -ForegroundColor Cyan
$files = @(
  'src/pages/KidModePage.tsx',
  'src/components/channels/ChannelManager.tsx',
  'scripts/deploy-kid-channel-search-vercel.ps1'
)
foreach ($f in $files) {
  if (Test-Path (Join-Path $Root $f)) { git add $f }
}
$pending = git diff --cached --name-only
if ($pending) {
  git commit -m @"
fix(kid): public channel video search on /kid watch only

Single always-visible search bar in kid watch mode (no PIN). Remove parent /channels preview search.
"@
  if ($LASTEXITCODE -ne 0) { throw "git commit failed ($LASTEXITCODE)" }
  Write-Host "OK: committed $($pending.Count) path(s)" -ForegroundColor Green
} else {
  Write-Host 'Nothing new to commit.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== 3/4 Push origin main ===' -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) { throw "git push failed ($LASTEXITCODE)" }
Write-Host 'OK: pushed' -ForegroundColor Green

Write-Host ''
Write-Host '=== 4/4 Wait for Vercel production ===' -ForegroundColor Cyan
Start-Sleep -Seconds 12
$ready = $false
foreach ($i in 1..30) {
  $lines = npx vercel ls 2>&1 | Out-String
  if ($lines -match 'Ready\s+Production') {
    $first = ($lines -split "`n" | Where-Object { $_ -match 'Ready\s+Production' } | Select-Object -First 1)
    Write-Host 'OK: production Ready.' -ForegroundColor Green
    Write-Host $first.Trim() -ForegroundColor DarkGray
    $ready = $true
    break
  }
  Write-Host "  waiting... ($i/30)" -ForegroundColor DarkGray
  Start-Sleep -Seconds 10
}
if (-not $ready) {
  Write-Host 'Still building — check Vercel dashboard.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'DONE. Kid watch: https://www.safetube.co.il/kid (tab צפייה, no PIN)' -ForegroundColor Green
