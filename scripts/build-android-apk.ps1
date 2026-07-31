# Builds the SafeTube Android debug APK end-to-end:
#   web build -> capacitor sync -> gradle assembleDebug
# Toolchain lives in C:\android-tools (JDK 21 + Android SDK 36), set up outside the repo.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (Test-Path 'C:\android-tools\jdk21') { $env:JAVA_HOME = 'C:\android-tools\jdk21' }
if (Test-Path 'C:\android-tools\sdk') { $env:ANDROID_HOME = 'C:\android-tools\sdk' }
if ($env:JAVA_HOME) { $env:Path = "$env:JAVA_HOME\bin;$env:Path" }

Set-Location $root
npm run build
if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw 'cap sync failed' }

Set-Location (Join-Path $root 'android')
.\gradlew.bat assembleDebug
if ($LASTEXITCODE -ne 0) { throw 'gradle build failed' }

$apk = Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk'
Write-Host ''
Write-Host "APK ready: $apk ($([math]::Round((Get-Item $apk).Length/1MB,1)) MB)"
