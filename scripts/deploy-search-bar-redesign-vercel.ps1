# One-shot: build, commit search bar redesign, push main.
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

Write-Host '=== 1/3 Build ===' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed ($LASTEXITCODE)" }

Write-Host '=== 2/3 Commit ===' -ForegroundColor Cyan
git add src/components/kid/ChannelVideoSearchBar.tsx src/pages/KidModePage.tsx scripts/deploy-search-bar-redesign-vercel.ps1
$pending = git diff --cached --name-only
if ($pending) {
  git commit -m "fix(kid): redesign channel search bar for mobile dark UI"
  if ($LASTEXITCODE -ne 0) { throw "commit failed" }
}

Write-Host '=== 3/3 Push ===' -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) { throw "push failed" }
Write-Host 'DONE — https://www.safetube.co.il/kid' -ForegroundColor Green
