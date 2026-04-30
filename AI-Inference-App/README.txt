# DINOv2 AI Inference System

## How to Run:
1. Double-click `Run_AI.bat`.
2. The app will launch in your System Tray (near the clock).
3. Right-click the icon to Copy the URL or see Logs.

## Files:
- main.py: Tray app logic.
- server.py: AI API server.
- model_dinov2.py: AI model architecture.
- models/: Place your .pt models here.
- venv/: Automatically created virtual environment.

## Public Access:
- For Zero-Config: Right-click tray -> Start Public Tunnel (Zero-Config).
- For Ngrok: Place your token in `ngrok_token.txt` and use Start Ngrok.
