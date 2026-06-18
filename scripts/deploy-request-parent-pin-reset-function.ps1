# Deploy Supabase Edge Function: request-parent-pin-reset (forgot parent PIN email).
# Prerequisites: Supabase CLI, login, RESEND_API_KEY in project secrets.
#
# Usage:
#   .\scripts\deploy-request-parent-pin-reset-function.ps1
#   .\scripts\deploy-request-parent-pin-reset-function.ps1 -ProjectRef ioylyyqlluenkkltguhf
#
# One-time login:
#   npx supabase login
#
# Set secrets (replace values — never commit real keys):
#   npx supabase secrets set RESEND_API_KEY=re_xxxx --project-ref ioylyyqlluenkkltguhf
#   npx supabase secrets set RESEND_FROM="SafeTube <support@safetube.co.il>" --project-ref ioylyyqlluenkkltguhf
#   npx supabase secrets set PIN_RESET_REQUEST_SECRET=YOUR_WELCOME_KEY --project-ref ioylyyqlluenkkltguhf
#
# Optional alias (same value as PIN_RESET_REQUEST_SECRET):
#   npx supabase secrets set MEDIA_BRIDGE_WELCOME_KEY=YOUR_WELCOME_KEY --project-ref ioylyyqlluenkkltguhf

param(
    [string]$ProjectRef = 'ioylyyqlluenkkltguhf',
    [switch]$SkipSecretsCheck
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$FunctionName = 'request-parent-pin-reset'

Write-Host "=== Deploy Edge Function: $FunctionName ===" -ForegroundColor Cyan
Write-Host "Project ref: $ProjectRef" -ForegroundColor DarkGray

Write-Host ''
Write-Host '=== 1/3 Supabase CLI ===' -ForegroundColor Cyan
$cliVersion = npx supabase --version 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Supabase CLI not available. Run: npm install -g supabase  OR  npx supabase login"
}
Write-Host "CLI: $($cliVersion -join ' ')" -ForegroundColor Green

if (-not $SkipSecretsCheck) {
    Write-Host ''
    Write-Host '=== 2/3 Secrets (manual check) ===' -ForegroundColor Cyan
    Write-Host 'Required in Supabase Dashboard -> Edge Functions -> Secrets:' -ForegroundColor White
    Write-Host '  RESEND_API_KEY          (from resend.com)' -ForegroundColor Yellow
    Write-Host '  RESEND_FROM             e.g. SafeTube <support@safetube.co.il>' -ForegroundColor Yellow
    Write-Host '  PIN_RESET_REQUEST_SECRET  same as VITE_MEDIA_BRIDGE_WELCOME_KEY / MEDIA_BRIDGE_WELCOME_KEY' -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Set via CLI example:' -ForegroundColor DarkGray
    Write-Host "  npx supabase secrets set RESEND_API_KEY=re_xxx --project-ref $ProjectRef" -ForegroundColor DarkGray
}

Write-Host "=== 3/3 Deploy $FunctionName ===" -ForegroundColor Cyan

# Supabase CLI auto-loads .env.local; a BOM or bad line breaks deploy on Windows.
$envLocal = Join-Path $Root '.env.local'
$envLocalBak = $null
if (Test-Path $envLocal) {
    $envLocalBak = "$envLocal.deploy-bak"
    if (Test-Path $envLocalBak) { Remove-Item -Force $envLocalBak }
    Rename-Item -LiteralPath $envLocal -NewName (Split-Path $envLocalBak -Leaf)
    Write-Host 'Temporarily moved .env.local aside for CLI (BOM-safe deploy).' -ForegroundColor DarkGray
}

try {
    npx supabase functions deploy $FunctionName --project-ref $ProjectRef
    if ($LASTEXITCODE -ne 0) { throw "supabase functions deploy failed ($LASTEXITCODE)" }
} finally {
    if ($envLocalBak -and (Test-Path $envLocalBak)) {
        Rename-Item -LiteralPath $envLocalBak -NewName '.env.local'
    }
}

$Url = "https://$ProjectRef.supabase.co/functions/v1/$FunctionName"
Write-Host ''
Write-Host "OK: deployed -> $Url" -ForegroundColor Green
Write-Host ''
Write-Host 'If deploy failed, run:' -ForegroundColor Yellow
Write-Host '  npx supabase login' -ForegroundColor White
Write-Host "  npx supabase link --project-ref $ProjectRef" -ForegroundColor White
Write-Host ''
Write-Host 'Smoke test (expect 401 without auth):' -ForegroundColor Cyan
Write-Host "  curl -X POST `"$Url`" -H `"Content-Type: application/json`" -d `"{\`"email\`":\`"test@example.com\`"}`"" -ForegroundColor DarkGray
Write-Host ''
Write-Host 'After deploy: redeploy Vercel frontend if not already on latest main (Supabase-first pin reset).' -ForegroundColor White
