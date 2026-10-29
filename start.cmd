@echo off
rem BrewAI: desktop app + admin console together (double-click this file).
rem Runs node directly (no npm layer): the PowerShell policy (npm.ps1) does not matter, and
rem Ctrl+C is not reported as an error (npm on Windows exits 1 when it forwards Ctrl+C).
rem Stop: Ctrl+C in this window (answer Y), or close the desktop app window.
rem ASCII only on purpose: cmd reads .cmd files in the console code page, not UTF-8.
setlocal
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [brewai] Node.js / npm not found. Install Node 24.22.1 first - README step 1.
  pause
  exit /b 1
)
node "%~dp0scripts\dev-all.mjs"
if errorlevel 1 (
  echo.
  echo [brewai] Stopped with an error. Read the messages above.
  pause
)
popd
endlocal
