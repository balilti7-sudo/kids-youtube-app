# Builds the SafeTube Android debug APK end-to-end:
#   web build -> capacitor sync -> version stamp -> gradle assembleDebug
# Toolchain lives in C:\android-tools (JDK 21 + Android SDK 36), set up outside the repo.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (Test-Path 'C:\android-tools\jdk21') { $env:JAVA_HOME = 'C:\android-tools\jdk21' }
if (Test-Path 'C:\android-tools\sdk') { $env:ANDROID_HOME = 'C:\android-tools\sdk' }
if ($env:JAVA_HOME) { $env:Path = "$env:JAVA_HOME\bin;$env:Path" }

Set-Location $root

# --- Version stamp from package.json ---
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$versionName = [string]$pkg.version
if (-not $versionName) { throw 'package.json version is missing' }

# versionCode: major*10000 + minor*100 + patch (e.g. 1.1.0 -> 10100)
$parts = $versionName.Split('.')
$major = if ($parts.Length -gt 0) { [int]$parts[0] } else { 1 }
$minor = if ($parts.Length -gt 1) { [int]$parts[1] } else { 0 }
$patch = if ($parts.Length -gt 2) { [int]($parts[2] -replace '[^0-9].*','') } else { 0 }
$versionCode = ($major * 10000) + ($minor * 100) + $patch
$displayName = "SafeTube $versionName"
$buildStamp = Get-Date -Format 'yyyyMMdd-HHmm'

Write-Host "Stamping Android build: versionName=$versionName versionCode=$versionCode displayName=$displayName"

$gradlePath = Join-Path $root 'android\app\build.gradle'
$gradle = Get-Content $gradlePath -Raw
if ($gradle -notmatch 'versionCode\s+\d+') { throw 'versionCode not found in android/app/build.gradle' }
$gradle = [regex]::Replace($gradle, 'versionCode\s+\d+', "versionCode $versionCode")
$gradle = [regex]::Replace($gradle, 'versionName\s+"[^"]*"', "versionName `"$versionName`"")
# Ensure version fields exist inside defaultConfig if they were missing historically
if ($gradle -notmatch 'versionName\s+"') {
  $gradle = $gradle -replace '(applicationId\s+"[^"]+"\s*\r?\n)', "`$1        versionCode $versionCode`r`n        versionName `"$versionName`"`r`n"
}
Set-Content -Path $gradlePath -Value $gradle -NoNewline

$stringsPath = Join-Path $root 'android\app\src\main\res\values\strings.xml'
[xml]$stringsXml = Get-Content $stringsPath
$appNameNode = $stringsXml.resources.string | Where-Object { $_.name -eq 'app_name' }
$titleNode = $stringsXml.resources.string | Where-Object { $_.name -eq 'title_activity_main' }
if (-not $appNameNode) { throw 'app_name missing in strings.xml' }
$appNameNode.InnerText = $displayName
if ($titleNode) { $titleNode.InnerText = $displayName }
$stringsXml.Save($stringsPath)

node ./scripts/patch-capacitor-webview.mjs
if ($LASTEXITCODE -ne 0) { throw 'capacitor webview patch failed' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw 'cap sync failed' }

# Re-apply display name after cap sync (sync can restore plugin assets, not usually strings, but keep stamp)
[xml]$stringsXml2 = Get-Content $stringsPath
$appNameNode2 = $stringsXml2.resources.string | Where-Object { $_.name -eq 'app_name' }
$titleNode2 = $stringsXml2.resources.string | Where-Object { $_.name -eq 'title_activity_main' }
if ($appNameNode2) { $appNameNode2.InnerText = $displayName }
if ($titleNode2) { $titleNode2.InnerText = $displayName }
$stringsXml2.Save($stringsPath)

Set-Location (Join-Path $root 'android')
.\gradlew.bat assembleDebug
if ($LASTEXITCODE -ne 0) { throw 'gradle build failed' }

$outDir = Join-Path $root 'android\app\build\outputs\apk\debug'
$defaultApk = Join-Path $outDir 'app-debug.apk'
$versionedApk = Join-Path $outDir "SafeTube-$versionName-debug-$buildStamp.apk"
Copy-Item -Path $defaultApk -Destination $versionedApk -Force

Write-Host ''
Write-Host "APK ready: $versionedApk ($([math]::Round((Get-Item $versionedApk).Length/1MB,1)) MB)"
Write-Host "Also at: $defaultApk"
Write-Host "App label: $displayName | versionName=$versionName | versionCode=$versionCode"
