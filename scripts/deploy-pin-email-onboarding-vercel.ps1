# Build, commit PIN onboarding + welcome key sync, push, wait for Vercel production.
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

Write-Host '=== 0/5 Sync welcome key (Vercel + .env.local) ===' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'sync-media-bridge-welcome-key.ps1')

Write-Host ''
Write-Host '=== 1/5 Production build ===' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed ($LASTEXITCODE)" }

Write-Host ''
Write-Host '=== 2/5 Commit ===' -ForegroundColor Cyan
$files = @(
  'src/lib/pendingParentPin.ts',
  'src/components/auth/RegisterForm.tsx',
  'src/pages/SetParentPinPage.tsx',
  'src/pages/AuthCallback.tsx',
  'src/stores/authStore.ts',
  'src/App.tsx',
  '.env.example',
  'scripts/sync-media-bridge-welcome-key.ps1',
  'scripts/deploy-pin-email-onboarding-vercel.ps1'
)
foreach ($f in $files) {
  if (Test-Path (Join-Path $Root $f)) { git add $f }
}
$pending = git diff --cached --name-only
if ($pending) {
  git commit -m @"
fix(auth): sync welcome key, registration PIN, forgot-PIN email

- Registration collects parent PIN; applies after first login + emails PIN
- VITE_MEDIA_BRIDGE_WELCOME_KEY sync script for Vercel and Germany bridge
- Auth callback routes through SmartEntry for set-parent-pin / onboarding
"@
  if ($LASTEXITCODE -ne 0) { throw 'git commit failed' }
}

Write-Host ''
Write-Host '=== 3/5 Push main ===' -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) { throw 'git push failed' }

Write-Host ''
Write-Host '=== 4/5 Trigger production deploy ===' -ForegroundColor Cyan
npx vercel deploy --prod --yes 2>&1 | ForEach-Object { Write-Host $_ }

Write-Host ''
Write-Host '=== 5/5 Done ===' -ForegroundColor Green
Write-Host 'Test forgot PIN: https://www.safetube.co.il — run bridge restart on Germany if email still fails.' -ForegroundColor White
