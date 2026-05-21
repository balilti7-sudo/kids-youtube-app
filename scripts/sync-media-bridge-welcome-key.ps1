# Sync MEDIA_BRIDGE_WELCOME_KEY (Germany bridge) with VITE_MEDIA_BRIDGE_WELCOME_KEY (Vercel).
# Generates a key if missing; updates bridge.env (admin) and Vercel production + preview.
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$EnvLocal = Join-Path $Root '.env.local'
$BridgeEnv = 'C:\ProgramData\SafeTube\bridge.env'
$KeyNameBridge = 'MEDIA_BRIDGE_WELCOME_KEY'
$KeyNameVite = 'VITE_MEDIA_BRIDGE_WELCOME_KEY'

function Read-EnvValue {
    param([string]$Path, [string]$Name)
    if (-not (Test-Path $Path)) { return $null }
    try {
        $null = Get-Content -LiteralPath $Path -Encoding UTF8 -TotalCount 1 -ErrorAction Stop
    } catch {
        return $null
    }
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.*)\s*$") {
            $v = $Matches[1].Trim()
            if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
            if ($v -and $v -notmatch '^(YOUR_|FIXME|re_YOUR)') { return $v }
        }
    }
    return $null
}

function Upsert-EnvLine {
    param([string]$Path, [string]$Name, [string]$Value)
    $lines = @()
    if (Test-Path $Path) {
        $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
    }
    $out = [System.Collections.Generic.List[string]]::new()
    $replaced = $false
    foreach ($line in $lines) {
        if ($line -match "^\s*$([regex]::Escape($Name))\s*=") {
            $out.Add("$Name=$Value") | Out-Null
            $replaced = $true
        } else {
            $out.Add($line) | Out-Null
        }
    }
    if (-not $replaced) {
        if ($out.Count -gt 0 -and $out[$out.Count - 1] -ne '') { $out.Add('') | Out-Null }
        $out.Add("# Media Bridge welcome key (sync-media-bridge-welcome-key.ps1)") | Out-Null
        $out.Add("$Name=$Value") | Out-Null
    }
    Set-Content -LiteralPath $Path -Value $out -Encoding utf8
}

$key = Read-EnvValue $EnvLocal $KeyNameVite
if (-not $key) { $key = Read-EnvValue $EnvLocal $KeyNameBridge }
if (-not $key) { $key = Read-EnvValue $BridgeEnv $KeyNameBridge }
if (-not $key) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $key = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', 'x').Replace('/', 'y')
    Write-Host "[sync-welcome] generated new key" -ForegroundColor Yellow
}

Write-Host "[sync-welcome] key length: $($key.Length)" -ForegroundColor Cyan

Upsert-EnvLine $EnvLocal $KeyNameVite $key
Upsert-EnvLine $EnvLocal $KeyNameBridge $key
Write-Host "[sync-welcome] updated $EnvLocal" -ForegroundColor Green

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isAdmin -and (Test-Path $BridgeEnv)) {
    Upsert-EnvLine $BridgeEnv $KeyNameBridge $key
    Write-Host "[sync-welcome] updated $BridgeEnv" -ForegroundColor Green
    Write-Host "[sync-welcome] restart bridge: Restart-Service SafeTubeBridge (or restart-germany-bridge.ps1)" -ForegroundColor Yellow
} elseif (-not $isAdmin) {
    Write-Host "[sync-welcome] skip bridge.env (run this script as Administrator to update $BridgeEnv)" -ForegroundColor Yellow
}

Set-Location $Root
foreach ($envName in @('production', 'preview')) {
    Write-Host "[sync-welcome] Vercel env $KeyNameVite -> $envName ..." -ForegroundColor Cyan
    $key | npx vercel env add $KeyNameVite $envName --force 2>&1 | ForEach-Object { Write-Host $_ }
}
Write-Host "[sync-welcome] done. Redeploy Vercel production for the new env var to ship." -ForegroundColor Green
