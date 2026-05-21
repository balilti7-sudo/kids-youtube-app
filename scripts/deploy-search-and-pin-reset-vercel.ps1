# One-shot: build, commit search visibility + PIN reset flow, push main.
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

Write-Host '=== Build ===' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed ($LASTEXITCODE)" }

Write-Host '=== Commit ===' -ForegroundColor Cyan
git add `
  src/pages/KidModePage.tsx `
  src/components/kid/ChannelVideoSearchBar.tsx `
  src/components/parental/ParentalForgotPinModal.tsx `
  src/components/parental/ParentalManagementGate.tsx `
  src/components/settings/ParentPinSettingsCard.tsx `
  src/components/settings/SettingsPanel.tsx `
  src/pages/ProfilePage.tsx `
  src/lib/requestParentPinResetEmail.ts `
  server/email/welcomeRoute.js `
  server/email/sendPinReset.js `
  server/register-email-routes.mjs `
  scripts/deploy-search-and-pin-reset-vercel.ps1
$pending = git diff --cached --name-only
if ($pending) {
  git commit -m @"
fix(kid): channel video search above list; email-only forgot parent PIN

Search bar on kid channel list column. Forgot PIN sends email reset; manual PIN change in Settings only.
"@
}

Write-Host '=== Push ===' -ForegroundColor Cyan
git push origin main
Write-Host 'DONE — Vercel: https://www.safetube.co.il/kid | Restart Germany bridge for pin-reset email' -ForegroundColor Green
