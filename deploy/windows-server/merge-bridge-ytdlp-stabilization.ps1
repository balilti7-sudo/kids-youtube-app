<#
.SYNOPSIS
    Upserts yt-dlp stabilization keys into C:\ProgramData\SafeTube\bridge.env (idempotent).

.DESCRIPTION
    Adds / replaces:
      YT_DLP_PRIMARY_EXTRACTOR_ARGS=youtube:player_client=tv,web_safari
      YT_DLP_BGUTIL_POT_BASE_URL=http://127.0.0.1:4416
      YT_DLP_COOKIES_FILE=./youtube_cookies.txt
      YT_DLP_FORMAT=bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best

    SafeTubeBridge reads this file via start-bridge.ps1; nssm AppParameters do not need to change.

    After running:  Restart-Service SafeTubeBridge
#>

#Requires -Version 5.1

param(
    [string]$EnvFile = (Join-Path $env:ProgramData 'SafeTube\bridge.env'),
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$updates = [ordered]@{
    'YT_DLP_PRIMARY_EXTRACTOR_ARGS' = 'youtube:player_client=tv,web_safari'
    'YT_DLP_BGUTIL_POT_BASE_URL'    = 'http://127.0.0.1:4416'
    'YT_DLP_COOKIES_FILE'           = './youtube_cookies.txt'
    'YT_DLP_FORMAT'                 = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best'
}

if (-not (Test-Path $EnvFile)) {
    throw "Env file not found: $EnvFile - create it from safetube-bridge.env.example or run install.ps1 first."
}

$lines = @()
try {
    $lines = @(Get-Content -LiteralPath $EnvFile -Encoding UTF8)
} catch {
    throw "Cannot read $EnvFile : $($_.Exception.Message). If this is the production bridge.env, run PowerShell as Administrator, or copy the file elsewhere and pass -EnvFile."
}
$keysToReplace = [System.Collections.Generic.HashSet[string]]::new([string[]]@($updates.Keys))
$out = [System.Collections.Generic.List[string]]::new()

foreach ($line in $lines) {
    if ($line -match '^\s*# --- yt-dlp stabilization') { continue }
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
        $k = $Matches[1]
        if ($keysToReplace.Contains($k)) { continue }
    }
    $out.Add($line) | Out-Null
}

$out.Add('') | Out-Null
$out.Add('# --- yt-dlp stabilization (merge-bridge-ytdlp-stabilization.ps1) ---') | Out-Null
foreach ($e in $updates.GetEnumerator()) {
    $out.Add("$($e.Key)=$($e.Value)") | Out-Null
}

if ($WhatIf) {
    $out | ForEach-Object { Write-Host $_ }
    Write-Host "[merge-ytdlp] WhatIf: would write $($out.Count) lines to $EnvFile" -ForegroundColor Cyan
    exit 0
}

Set-Content -LiteralPath $EnvFile -Value $out -Encoding utf8
Write-Host "[merge-ytdlp] updated $EnvFile - run: Restart-Service SafeTubeBridge" -ForegroundColor Green
