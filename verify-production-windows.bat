@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ was not found.
  pause
  exit /b 1
)
node scripts\verify-production.mjs
set STATUS=%ERRORLEVEL%
pause
exit /b %STATUS%
