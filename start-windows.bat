@echo off
REM ============================================================
REM  Stage Timer starten
REM  Andere poort nodig? Pas het getal hieronder aan (bv. 8080).
REM  Pincode voor de bediening? Vul PIN in (leeg = geen pincode).
REM ============================================================
set PORT=3000
set PIN=

cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is niet geinstalleerd. Download het via https://nodejs.org
  pause
  exit /b 1
)
start "" http://localhost:%PORT%/
if "%PIN%"=="" (
  node server.js --port %PORT%
) else (
  node server.js --port %PORT% --pin %PIN%
)
pause
