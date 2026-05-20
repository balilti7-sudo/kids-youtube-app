# One-shot: build frontend, commit PIN-changed email feature, push, Vercel production deploy.
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

Write-Host '=== 1/4 Build frontend ===' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed ($LASTEXITCODE)" }
Write-Host 'OK: build' -ForegroundColor Green

Write-Host ''
Write-Host '=== 2/4 Commit ===' -ForegroundColor Cyan
$paths = @(
  'server/email/sendPinChanged.js',
  'server/email/welcomeRoute.js',
  'server/register-email-routes.mjs',
  'server/index.cjs',
  'src/lib/requestPinChangedEmail.ts',
  'src/pages/ProfilePage.tsx',
  'scripts/deploy-pin-changed-email.ps1'
)
foreach ($p in $paths) {
  if (Test-Path (Join-Path $Root $p)) { git add $p }
}
$staged = git diff --cached --name-only
if (-not $staged) {
  Write-Host 'Nothing to commit.' -ForegroundColor Yellow
} else {
  git commit -m @"
feat(email): notify parent when PIN changes (no PIN in email)

- Media Bridge POST /api/email/pin-changed via Resend
- Profile page triggers email after successful PIN update
- Register email routes on bridge startup
"@
  if ($LASTEXITCODE -ne 0) { throw "git commit failed" }
  Write-Host "OK: committed $($staged.Count) files" -ForegroundColor Green
}

Write-Host ''
Write-Host '=== 3/4 Push origin main ===' -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) { throw "git push failed" }
Write-Host 'OK: pushed' -ForegroundColor Green

Write-Host ''
Write-Host '=== 4/4 Wait for Vercel production (Git) ===' -ForegroundColor Cyan
Start-Sleep -Seconds 10
$ok = $false
foreach ($i in 1..30) {
  $out = npx vercel ls 2>&1 | Out-String
  if ($out -match '● Ready\s+Production') {
    $line = ($out -split "`n" | Where-Object { $_ -match 'Ready\s+Production' } | Select-Object -First 1).Trim()
    Write-Host "OK: $line" -ForegroundColor Green
    $ok = $true
    break
  }
  if ($i -ge 4 -and $out -match '● Error\s+Production') {
    $errLine = ($out -split "`n" | Where-Object { $_ -match 'Error\s+Production' } | Select-Object -First 1)
    if ($errLine -match 'https://([^\s]+)') {
      npx vercel inspect "https://$($Matches[1])" --logs 2>&1 | Select-Object -Last 20
    }
    throw 'Vercel production deploy failed'
  }
  Write-Host "  building... ($i/30)" -ForegroundColor DarkGray
  Start-Sleep -Seconds 10
}
if (-not $ok) {
  Write-Host 'Check Vercel dashboard — push may still be building.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== Bridge (Germany server) — restart required ===' -ForegroundColor Yellow
Write-Host 'Copy updated server/ to the bridge host and restart NSSM/node so /api/email/pin-changed is live.' -ForegroundColor White
Write-Host 'Ensure server/.env has: RESEND_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY' -ForegroundColor White
Write-Host ''
Write-Host 'Frontend: https://www.safetube.co.il (after Vercel Ready)' -ForegroundColor Green
