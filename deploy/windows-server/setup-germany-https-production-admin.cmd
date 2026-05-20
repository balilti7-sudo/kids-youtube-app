@echo off
title SafeTube Germany HTTPS Production Setup
cd /d "%~dp0..\.."
echo Running ONE combined script (approve UAC if prompted)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-germany-https-production.ps1"
echo.
echo Exit code: %ERRORLEVEL%
pause
