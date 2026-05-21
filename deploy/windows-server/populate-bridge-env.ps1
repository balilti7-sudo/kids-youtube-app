#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Write production Supabase + Resend + welcome-key values into C:\ProgramData\SafeTube\bridge.env.

  Sources (first match wins per key):
    - deploy/windows-server/bridge.secrets.env (optional overrides, gitignored)
    - .env.local, .env, .env.vercel.pull (repo root)
    - Supabase CLI: projects api-keys (service_role + anon)
    - safetube-bridge.env.example defaults

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\windows-server\populate-bridge-env.ps1
#>

$ErrorActionPreference = 'Stop'

$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$BridgeEnv  = 'C:\ProgramData\SafeTube\bridge.env'
$ProjectRef = 'ioylyyqlluenkkltguhf'
$SupabaseUrl = "https://$ProjectRef.supabase.co"

function Write-Step { param([string]$m) Write-Host "[populate-bridge-env] $m" -ForegroundColor Cyan }
function Write-Ok   { param([string]$m) Write-Host "[populate-bridge-env] $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "[populate-bridge-env] $m" -ForegroundColor Yellow }

function Test-PlaceholderValue {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $true }
    return $Value -match '^(YOUR_|FIXME|re_YOUR)'
}

function Read-EnvFile {
    param([string]$Path)
    $map = @{}
    if (-not (Test-Path $Path)) { return $map }
    try {
        foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
            if ($line -match '^\s*(#|$)') { continue }
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
                $name = $Matches[1]
                $value = $Matches[2].Trim()
                if (($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) -or
                    ($value.StartsWith("'") -and $value.EndsWith("'") -and $value.Length -ge 2)) {
                    $value = $value.Substring(1, $value.Length - 2)
                }
                if (-not (Test-PlaceholderValue $value)) {
                    $map[$name] = $value
                }
            }
        }
    } catch {
        Write-Warn "skip unreadable: $Path ($($_.Exception.Message))"
    }
    return $map
}

function Merge-Maps {
    param([hashtable]$Into, [hashtable]$From)
    foreach ($k in $From.Keys) {
        if (-not (Test-PlaceholderValue $From[$k])) {
            $Into[$k] = $From[$k]
        }
    }
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warn 'Relaunching elevated...'
    $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    Start-Process powershell.exe -Verb RunAs -ArgumentList $arg -Wait
    exit $LASTEXITCODE
}

if (-not (Test-Path $BridgeEnv)) {
    $example = Join-Path $PSScriptRoot 'safetube-bridge.env.example'
    if (-not (Test-Path $example)) { throw "Missing $BridgeEnv and $example" }
    New-Item -ItemType Directory -Force -Path (Split-Path $BridgeEnv) | Out-Null
    Copy-Item -Force $example $BridgeEnv
    Write-Ok "Created $BridgeEnv from example"
}

$values = @{}

$sourceFiles = @(
    (Join-Path $PSScriptRoot 'bridge.secrets.env'),
    (Join-Path $RepoRoot '.env.vercel.pull'),
    (Join-Path $RepoRoot '.env.local'),
    (Join-Path $RepoRoot '.env')
)
foreach ($f in $sourceFiles) {
    Merge-Maps $values (Read-EnvFile $f)
}

# Map Vite-prefixed frontend vars
if ($values['VITE_SUPABASE_URL'] -and -not $values['SUPABASE_URL']) {
    $values['SUPABASE_URL'] = $values['VITE_SUPABASE_URL']
}
if ($values['VITE_SUPABASE_ANON_KEY'] -and -not $values['SUPABASE_ANON_KEY']) {
    $values['SUPABASE_ANON_KEY'] = $values['VITE_SUPABASE_ANON_KEY']
}
if ($values['VITE_MEDIA_BRIDGE_WELCOME_KEY'] -and -not $values['MEDIA_BRIDGE_WELCOME_KEY']) {
    $values['MEDIA_BRIDGE_WELCOME_KEY'] = $values['VITE_MEDIA_BRIDGE_WELCOME_KEY']
}

if (-not $values['SUPABASE_URL']) { $values['SUPABASE_URL'] = $SupabaseUrl }

Write-Step 'Fetching Supabase API keys (anon + service_role)...'
Set-Location $RepoRoot
$keysJson = npx supabase projects api-keys --project-ref $ProjectRef -o json 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "supabase projects api-keys failed: $keysJson" }
$keys = $keysJson | ConvertFrom-Json
foreach ($entry in $keys) {
    if ($entry.name -eq 'anon' -and $entry.api_key) {
        $values['SUPABASE_ANON_KEY'] = $entry.api_key
    }
    if ($entry.name -eq 'service_role' -and $entry.api_key) {
        $values['SUPABASE_SERVICE_ROLE_KEY'] = $entry.api_key
    }
}

if (-not $values['RESEND_FROM']) {
    $values['RESEND_FROM'] = 'SafeTube <support@safetube.co.il>'
}

$required = @(
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'RESEND_API_KEY',
    'MEDIA_BRIDGE_WELCOME_KEY'
)
$missing = @()
foreach ($key in $required) {
    if (-not $values[$key] -or (Test-PlaceholderValue $values[$key])) { $missing += $key }
}
if ($missing.Count -gt 0) {
    throw "Missing required values: $($missing -join ', '). Add RESEND_API_KEY to .env.local or bridge.secrets.env, run: npx vercel env pull .env.vercel.pull"
}

$keysToSet = [ordered]@{
    SUPABASE_URL              = $values['SUPABASE_URL']
    SUPABASE_ANON_KEY         = $values['SUPABASE_ANON_KEY']
    SUPABASE_SERVICE_ROLE_KEY = $values['SUPABASE_SERVICE_ROLE_KEY']
    RESEND_API_KEY            = $values['RESEND_API_KEY']
    RESEND_FROM               = $values['RESEND_FROM']
    MEDIA_BRIDGE_WELCOME_KEY  = $values['MEDIA_BRIDGE_WELCOME_KEY']
}

Write-Step "Updating $BridgeEnv (email + Supabase keys)"
$lines = @(Get-Content -LiteralPath $BridgeEnv -Encoding UTF8)
$replaceKeys = [System.Collections.Generic.HashSet[string]]::new([string[]]@($keysToSet.Keys))
$out = [System.Collections.Generic.List[string]]::new()

foreach ($line in $lines) {
    if ($line -match '^\s*# --- email routes \(deploy-germany-bridge') { continue }
    if ($line -match '^\s*# --- production email secrets') { continue }
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
        $k = $Matches[1]
        if ($replaceKeys.Contains($k)) { continue }
    }
    $out.Add($line) | Out-Null
}

$out.Add('') | Out-Null
$out.Add('# --- production email secrets (populate-bridge-env.ps1) ---') | Out-Null
foreach ($e in $keysToSet.GetEnumerator()) {
    $out.Add("$($e.Key)=$($e.Value)") | Out-Null
}

Set-Content -LiteralPath $BridgeEnv -Value $out -Encoding utf8
Write-Ok "Wrote $($keysToSet.Count) production keys to bridge.env (values not printed)"

foreach ($key in $required) {
    Write-Ok "  $key = OK"
}
