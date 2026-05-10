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
    echo        Then run: ollama pull qwen2-vl
    echo.
) else (
    echo [OK] Ollama found
    :: Check if Ollama is actually running
    curl -s http://localhost:11434/api/tags >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo [INFO] Ollama is installed but not running. Starting it...
        start "" /min ollama serve
        :: Wait a moment for it to start
        timeout /t 3 /nobreak >nul
        curl -s http://localhost:11434/api/tags >nul 2>&1
        if %ERRORLEVEL% neq 0 (
            echo [WARNING] Ollama failed to start. Video analysis may not work.
        ) else (
            echo [OK] Ollama started successfully
        )
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

:: ── Install dependencies (skip if already installed) ──────
echo [AI System] Checking dependencies...
.\venv\Scripts\python.exe -c "import flask" >nul 2>&1
if %ERRORLEVEL% equ 0 goto DEPS_OK

echo [AI System] Installing dependencies... (this may take a few minutes first time)
.\venv\Scripts\python.exe -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cu124
if %ERRORLEVEL% neq 0 (
    echo [WARNING] CUDA install failed, trying standard...
    .\venv\Scripts\python.exe -m pip install -r requirements.txt
)
goto DEPS_DONE

:DEPS_OK
echo [OK] Dependencies already installed

:DEPS_DONE

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
