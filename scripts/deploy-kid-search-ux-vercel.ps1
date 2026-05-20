# One-shot: build, commit kid search UX fixes, push main, wait for Vercel production.
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
  'src/components/kid/ChannelVideoSearchBar.tsx',
  'src/pages/KidModePage.tsx',
  'scripts/deploy-kid-search-ux-vercel.ps1'
)
foreach ($f in $files) {
  if (Test-Path (Join-Path $Root $f)) { git add $f }
}
$pending = git diff --cached --name-only
if ($pending) {
  git commit -m @"
fix(kid): channel search focus, icon, and clear button UX

Keep input focus while typing; inline search/clear adornments; defer video auto-select until blur.
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
    Write-Host 'OK: production Ready.' -ForegroundColor Green
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
Write-Host 'DONE. Test: https://www.safetube.co.il/kid' -ForegroundColor Green
