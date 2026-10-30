@echo off
rem BrewAI one-shot launcher for Windows (double-click). Same 4 steps as ./run.sh on mac:
rem   1/4 git pull --ff-only   only on a branch with an upstream and no modified tracked files (else says why and skips)
rem                            a failed pull (offline, diverged) only warns and runs the code you have
rem   2/4 npm ci               only when package-lock.json changed since the last install (stamp: node_modules\.brewai-lock)
rem   3/4 uv sync --locked
rem   4/4 node scripts\dev-all.mjs   gateway + conductor + desktop app + admin console (admin login: admin / admin, test stage)
rem Options: set BREWAI_RUN_DRY=1 (print steps only) / set BREWAI_RUN_NO_PULL=1 (skip step 1).
rem Runs dev-all with node directly (no npm layer): the PowerShell policy (npm.ps1) does not matter, and
rem Ctrl+C is not reported as an error (npm on Windows exits 1 when it forwards Ctrl+C).
rem Stop: Ctrl+C in this window (answer Y), or close the desktop app window.
rem ASCII only on purpose: cmd reads .cmd files in the console code page, not UTF-8.
setlocal
pushd "%~dp0"
set "DRY=%BREWAI_RUN_DRY%"
where node >nul 2>nul
if errorlevel 1 (
  echo [brewai] Node.js / npm not found. Install Node 24.22.1 first - README step 1.
  goto :fail
)

rem ---- 1/4 latest code ----
rem (no parentheses in SKIP texts: they are echoed inside a ( ) block)
echo [brewai] 1/4 git pull --ff-only
set "SKIP="
set "BRANCH="
set "UPSTREAM="
set "DIRTY="
if "%BREWAI_RUN_NO_PULL%"=="1" set "SKIP=BREWAI_RUN_NO_PULL=1"
if "%BREWAI_RUN_PULLED%"=="1" set "SKIP=already pulled - this is the fresh start.cmd"
if not defined SKIP (
  where git >nul 2>nul
  if errorlevel 1 set "SKIP=git not found"
)
if not defined SKIP (
  for /f "delims=" %%b in ('git symbolic-ref -q --short HEAD 2^>nul') do set "BRANCH=%%b"
  for /f "delims=" %%u in ('git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2^>nul') do set "UPSTREAM=%%u"
  for /f "delims=" %%l in ('git status --porcelain -uno 2^>nul') do set "DIRTY=1"
)
if not defined SKIP if not defined BRANCH set "SKIP=not on a branch - detached HEAD or not a git folder"
if not defined SKIP if not defined UPSTREAM set "SKIP=branch %BRANCH% has no upstream - local-only branch"
if not defined SKIP if defined DIRTY set "SKIP=you have modified files - commit or clean up first"
if defined SKIP (
  echo [brewai]   skipped: %SKIP%
) else (
  echo [brewai]   %BRANCH% from %UPSTREAM%
  if "%DRY%"=="1" (
    echo           ^(dry^) git pull --ff-only
  ) else (
    git pull --ff-only
    if errorlevel 1 (
      echo [brewai]   git pull failed ^(network or diverged commits^) - going on with the code you have. Skip next time: set BREWAI_RUN_NO_PULL=1
    ) else (
      rem cmd reads a .cmd file from disk as it runs: the pull may have changed this file, so run the fresh copy and stop here
      set "BREWAI_RUN_NO_PULL=1"
      set "BREWAI_RUN_PULLED=1"
      popd
      call "%~f0" %*
      exit /b
    )
  )
)

rem ---- 2/4 node dependencies ----
echo [brewai] 2/4 npm ci (only when package-lock.json changed)
set "LOCKHASH="
set "OLDHASH="
for /f "usebackq delims=" %%h in (`node -e "process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync('package-lock.json')).digest('hex'))"`) do set "LOCKHASH=%%h"
if not defined LOCKHASH (
  echo [brewai] Could not read package-lock.json.
  goto :fail
)
if exist "node_modules\.brewai-lock" set /p OLDHASH=<"node_modules\.brewai-lock"
if exist "node_modules\" if "%LOCKHASH%"=="%OLDHASH%" (
  echo [brewai]   unchanged since the last install
  goto :uv
)
if "%DRY%"=="1" (
  echo           ^(dry^) npm ci
  goto :uv
)
call npm ci
if errorlevel 1 (
  echo [brewai] npm ci failed. Read the npm messages above ^(network, Node version 24.22.1^).
  goto :fail
)
> "node_modules\.brewai-lock" echo %LOCKHASH%

:uv
rem ---- 3/4 python dependencies ----
echo [brewai] 3/4 uv sync --locked
where uv >nul 2>nul
if errorlevel 1 (
  echo [brewai]   skipped: uv not found - README step 1 ^(uv 0.13.5^). Desktop and admin start without conductor.
  goto :dev
)
if "%DRY%"=="1" (
  echo           ^(dry^) uv sync --locked
  goto :dev
)
uv sync --locked
if errorlevel 1 (
  echo [brewai] uv sync --locked failed ^(uv.lock out of date, or network - try set UV_HTTP_TIMEOUT=300^).
  goto :fail
)

:dev
rem ---- 4/4 run ----
echo [brewai] 4/4 node scripts\dev-all.mjs %*
if "%DRY%"=="1" (
  echo           ^(dry^) node scripts\dev-all.mjs %*
  echo [brewai] dry run done - nothing changed
  goto :end
)
node "%~dp0scripts\dev-all.mjs" %*
if errorlevel 1 goto :fail
goto :end

:fail
echo.
echo [brewai] Stopped with an error. Read the messages above.
pause
popd
endlocal
exit /b 1

:end
popd
endlocal
