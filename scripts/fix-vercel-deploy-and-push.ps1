# One-shot: verify build, commit, push main, production deploy (Git + Vercel CLI).
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
  '.vercelignore',
  'src/lib/authDiagnostics.ts',
  'src/lib/changeParentPin.ts',
  'src/lib/parentalGateActivity.ts',
  'src/lib/mediaPlaybackActivity.ts',
  'src/lib/verifyParentProfilePin.ts',
  'src/components/layout/AppLayout.tsx',
  'src/components/player/CleanPlayer.tsx',
  'supabase/migrations/027_parent_pin_fix.sql',
  'scripts/apply-pin-and-timeout-fix.ps1',
  'scripts/fix-vercel-deploy-and-push.ps1'
)
foreach ($f in $files) {
  if (Test-Path (Join-Path $Root $f)) { git add $f }
}
$pending = git diff --cached --name-only
if ($pending) {
  git commit -m @"
fix(vercel): TS build error and trim deploy upload

- authDiagnostics: fix TS2367 USER_DELETED comparison for tsc -b
- Add .vercelignore so CLI/Git deploys stay under 100 MB (exclude server/)
- Parent PIN + idle-lock during playback (included in prior paths)
"@
  if ($LASTEXITCODE -ne 0) { throw "git commit failed ($LASTEXITCODE)" }
  Write-Host "OK: committed $($pending.Count) path(s)" -ForegroundColor Green
} else {
  Write-Host 'Nothing new to commit.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== 3/4 Push origin main (triggers Vercel Git deploy) ===' -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) { throw "git push failed ($LASTEXITCODE)" }
Write-Host 'OK: pushed' -ForegroundColor Green

Write-Host ''
Write-Host '=== 4/4 Wait for Vercel Git production deploy ===' -ForegroundColor Cyan
Start-Sleep -Seconds 8
$ready = $false
foreach ($i in 1..24) {
  $lines = npx vercel ls 2>&1 | Out-String
  if ($lines -match 'Production\s+(\d+)s\s+.*Ready' -or $lines -match '● Ready\s+Production') {
    $first = ($lines -split "`n" | Where-Object { $_ -match 'Ready\s+Production' } | Select-Object -First 1)
    if ($first -match 'Error') { continue }
    Write-Host "OK: latest production deployment is Ready." -ForegroundColor Green
    Write-Host $first.Trim() -ForegroundColor DarkGray
    $ready = $true
    break
  }
  if ($lines -match 'Production\s+\d+s\s+.*Error' -and $i -ge 3) {
    Write-Host 'Latest production deploy still Error — fetching logs...' -ForegroundColor Red
    $errLine = ($lines -split "`n" | Where-Object { $_ -match 'Error\s+Production' } | Select-Object -First 1)
    if ($errLine -match 'https://([^\s]+)') {
      npx vercel inspect "https://$($Matches[1])" --logs 2>&1 | Select-Object -Last 25
    }
    throw 'Vercel production deploy failed. See logs above.'
  }
  Write-Host "  waiting... ($i/24)" -ForegroundColor DarkGray
  Start-Sleep -Seconds 10
}
if (-not $ready) {
  Write-Host 'Deploy may still be building. Check: https://vercel.com/dashboard' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'DONE. Site: https://www.safetube.co.il' -ForegroundColor Green
Write-Host 'Run migration 027 in Supabase SQL Editor for PIN save.' -ForegroundColor Yellow
