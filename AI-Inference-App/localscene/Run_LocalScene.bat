@echo off
echo ============================================
echo    Local Scene Manager
echo    http://localhost:8899
echo ============================================
echo.
echo Make sure Run_AI.bat is running first!
echo.

cd /d "%~dp0.."

if exist "venv\Scripts\python.exe" (
    .\venv\Scripts\python.exe localscene\run.py
) else (
    python localscene\run.py
)

pause
