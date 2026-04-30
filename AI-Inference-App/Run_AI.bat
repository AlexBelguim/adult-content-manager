@echo off
echo [DEBUG] Script started...
set "APP_DIR=%~dp0"

if exist "%~dp0AI-Inference-App" (
    set "APP_DIR=%~dp0AI-Inference-App"
)

cd /d "%APP_DIR%"

:: Simple check for python
python --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python is not installed or not in your PATH.
    pause
    exit /b
)

:: Ensure venv
if not exist "venv" (
    echo [AI System] Creating virtual environment...
    python -m venv venv
)

echo [AI System] Checking/Installing dependencies...
:: First try to install with CUDA support explicitly (using cu124 for Python 3.13 support)
.\venv\Scripts\python.exe -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cu124 --no-cache-dir

if %ERRORLEVEL% neq 0 (
    echo [WARNING] CUDA installation might have failed, trying standard install...
    .\venv\Scripts\python.exe -m pip install -r requirements.txt
)

echo [AI System] Launching Server...
.\venv\Scripts\python.exe main.py

if %ERRORLEVEL% neq 0 (
    echo [ERROR] Server exited with code %ERRORLEVEL%
    pause
)

pause
