@echo off
setlocal
cd /d "%~dp0"
node scripts\set-data-backend.mjs supabase
if errorlevel 1 pause & exit /b 1
echo DATA_BACKEND=supabase is enabled. Restart BidMatch AI.
pause
endlocal
