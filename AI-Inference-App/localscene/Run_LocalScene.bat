@echo off
title Local Scene Manager
echo ============================================
echo    Local Scene Manager
echo    http://localhost:8899
echo ============================================
echo.
echo    AI server will auto-start if needed.
echo.

cd /d "%~dp0.."

if exist "venv\Scripts\python.exe" (
    .\venv\Scripts\python.exe localscene\run.py
) else (
    python localscene\run.py
)

pause
