# One-shot: Parent PIN fix (migration 027) + video idle-lock fix — build verify.
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Migration = Join-Path $Root 'supabase\migrations\027_parent_pin_fix.sql'

Write-Host '=== SafeTube: PIN + timeout fixes ===' -ForegroundColor Cyan
Write-Host ''
Write-Host 'STEP 1 (required) — Supabase Dashboard -> SQL Editor -> run IN FULL:' -ForegroundColor Yellow
Write-Host "  $Migration" -ForegroundColor White
Write-Host '  Uses profiles.parent_pin only (no access_code).' -ForegroundColor DarkGray
Write-Host ''
Write-Host 'STEP 2 — Deploy frontend after build below succeeds.' -ForegroundColor Yellow
Write-Host ''

Set-Location $Root
Write-Host '=== npm run build ===' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed ($LASTEXITCODE)" }

Write-Host ''
Write-Host 'OK: build passed.' -ForegroundColor Green
Write-Host ''
Write-Host 'Test:' -ForegroundColor Cyan
Write-Host '  A) Profile -> change PIN (no access_code error)' -ForegroundColor White
Write-Host '  B) Channels -> play video 5+ min without tapping -> no PIN gate' -ForegroundColor White
