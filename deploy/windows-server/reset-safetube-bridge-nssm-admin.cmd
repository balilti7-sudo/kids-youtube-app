@echo off
cd /d "%~dp0..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0reset-safetube-bridge-nssm.ps1"
exit /b %ERRORLEVEL%
