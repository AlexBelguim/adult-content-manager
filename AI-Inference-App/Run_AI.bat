@echo off
echo ============================================
echo    AI Inference App - Startup
echo ============================================
echo.

set "APP_DIR=%~dp0"

if exist "%~dp0AI-Inference-App" (
    set "APP_DIR=%~dp0AI-Inference-App"
)

cd /d "%APP_DIR%"

:: ── Check Python ──────────────────────────────────────────
python --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python is not installed or not in your PATH.
    echo         Download from: https://www.python.org/downloads/
    pause
    exit /b
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo [OK] %%v

:: ── Check FFmpeg (required for video analysis) ────────────
ffmpeg -version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [WARNING] FFmpeg is NOT installed or not in PATH.
    echo           Video analysis features will not work without FFmpeg.
    echo           Download from: https://www.gyan.dev/ffmpeg/builds/
    echo           Extract and add the bin folder to your system PATH.
    echo.
) else (
    echo [OK] FFmpeg found
)

:: ── Check ffprobe (comes with FFmpeg) ─────────────────────
ffprobe -version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [WARNING] ffprobe not found - make sure full FFmpeg package is installed.
) else (
    echo [OK] ffprobe found
)

:: ── Check Ollama (required for VLM video classification) ──
where ollama >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [INFO] Ollama not found in PATH.
    echo        Video scene classification requires Ollama with a vision model.
    echo        Install from: https://ollama.com/download
    echo        Then run: ollama pull gemma3:12b
    echo.
) else (
    echo [OK] Ollama found
    :: Check if Ollama is actually running
    curl -s http://localhost:11434/api/tags >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo [INFO] Ollama is installed but not running.
        echo        Start it with: ollama serve
        echo        Then pull a vision model: ollama pull gemma3:12b
    ) else (
        echo [OK] Ollama is running
    )
)

echo.

:: ── Ensure venv ───────────────────────────────────────────
if not exist "venv" (
    echo [AI System] Creating virtual environment...
    python -m venv venv
)

:: ── Install dependencies (skip if already done) ───────────
:: Only re-run pip if requirements.txt changed since last install
set "MARKER=venv\.deps_installed"
fc /b requirements.txt "%MARKER%" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [AI System] Installing/updating dependencies...
    .\venv\Scripts\python.exe -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cu124
    if %ERRORLEVEL% neq 0 (
        echo [WARNING] CUDA installation might have failed, trying standard install...
        .\venv\Scripts\python.exe -m pip install -r requirements.txt
    )
    copy /y requirements.txt "%MARKER%" >nul 2>&1
) else (
    echo [OK] Dependencies already installed
)

echo.
echo ============================================
echo    Launching AI Server...
echo    Image Inference: http://localhost:3344
echo    Video Analysis:  http://localhost:3344/video
echo ============================================
echo.

.\venv\Scripts\python.exe main.py

if %ERRORLEVEL% neq 0 (
    echo [ERROR] Server exited with code %ERRORLEVEL%
    pause
)

pause
