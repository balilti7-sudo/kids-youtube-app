# Builds the SafeTube Android debug APK end-to-end:
#   web build -> capacitor sync -> gradle assembleDebug (auto-bumps version) -> versioned APK copy
# Toolchain lives in C:\android-tools (JDK 21 + Android SDK 36), set up outside the repo.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (Test-Path 'C:\android-tools\jdk21') { $env:JAVA_HOME = 'C:\android-tools\jdk21' }
if (Test-Path 'C:\android-tools\sdk') { $env:ANDROID_HOME = 'C:\android-tools\sdk' }
if ($env:JAVA_HOME) { $env:Path = "$env:JAVA_HOME\bin;$env:Path" }

Set-Location $root

function Read-AndroidVersion {
  $propsPath = Join-Path $root 'android\app\version.properties'
  if (-not (Test-Path $propsPath)) { throw "Missing $propsPath" }
  $map = @{}
  Get-Content $propsPath | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    $pair = $_.Split('=', 2)
    if ($pair.Length -eq 2) { $map[$pair[0].Trim()] = $pair[1].Trim() }
  }
  $versionName = [string]$map['VERSION_NAME']
  $versionCode = [int]$map['VERSION_CODE']
  if (-not $versionName) { throw 'VERSION_NAME missing in version.properties' }
  if (-not $versionCode) { throw 'VERSION_CODE missing in version.properties' }
  return @{ Name = $versionName; Code = $versionCode }
}

function Sync-PackageJsonVersion([string]$versionName) {
  $pkgPath = Join-Path $root 'package.json'
  $raw = Get-Content $pkgPath -Raw
  $updated = [regex]::Replace($raw, '"version"\s*:\s*"[^"]*"', ('"version": "' + $versionName + '"'), 1)
  Set-Content -Path $pkgPath -Value $updated -NoNewline
}

function Stamp-AppDisplayName([string]$versionName) {
  $displayName = "SafeTube $versionName"
  $stringsPath = Join-Path $root 'android\app\src\main\res\values\strings.xml'
  [xml]$stringsXml = Get-Content $stringsPath
  $appNameNode = $stringsXml.resources.string | Where-Object { $_.name -eq 'app_name' }
  $titleNode = $stringsXml.resources.string | Where-Object { $_.name -eq 'title_activity_main' }
  if (-not $appNameNode) { throw 'app_name missing in strings.xml' }
  $appNameNode.InnerText = $displayName
  if ($titleNode) { $titleNode.InnerText = $displayName }
  $stringsXml.Save($stringsPath)
  return $displayName
}

$buildStamp = Get-Date -Format 'yyyyMMdd-HHmm'

node ./scripts/patch-capacitor-webview.mjs
if ($LASTEXITCODE -ne 0) { throw 'capacitor webview patch failed' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw 'cap sync failed' }

# Gradle bumps version.properties during configuration of assemble*
Set-Location (Join-Path $root 'android')
.\gradlew.bat assembleDebug
if ($LASTEXITCODE -ne 0) { throw 'gradle build failed' }
Set-Location $root

$ver = Read-AndroidVersion
$versionName = $ver.Name
$versionCode = $ver.Code
Sync-PackageJsonVersion $versionName
$displayName = Stamp-AppDisplayName $versionName

$outDir = Join-Path $root 'android\app\build\outputs\apk\debug'
$defaultApk = Join-Path $outDir 'app-debug.apk'
$versionedApk = Join-Path $outDir "SafeTube-$versionName-debug-$buildStamp.apk"
Copy-Item -Path $defaultApk -Destination $versionedApk -Force

Write-Host ''
Write-Host "APK ready: $versionedApk ($([math]::Round((Get-Item $versionedApk).Length/1MB,1)) MB)"
Write-Host "Also at: $defaultApk"
Write-Host "App label: $displayName | versionName=$versionName | versionCode=$versionCode"
Write-Host "(version auto-bumped by Gradle; package.json synced)"
