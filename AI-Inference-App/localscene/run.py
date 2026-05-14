"""
Local Scene Manager — Standalone test tool for video analysis.
Serves a web UI on port 8899 that:
  - Streams video files from local disk
  - Proxies API calls to the AI Flask server (port 3344)

Usage:  python localscene/run.py
"""
import os
import sys
import json
import mimetypes
import webbrowser
import threading
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlparse, unquote
import urllib.request
import urllib.error

PORT = 8899
AI_SERVER = "http://localhost:3344"

class LocalSceneHandler(SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(os.path.abspath(__file__)), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/' or parsed.path == '':
            self.path = '/index.html'
            return super().do_GET()

        # Proxy GET /api/* → AI server /video/*
        if parsed.path.startswith('/api/'):
            return self._proxy_get()

        # Stream video files:  /stream?path=C:\Videos\test.mp4
        if parsed.path == '/stream':
            return self._stream_video(parsed)

        return super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/'):
            return self._proxy_post()
        self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    # ── Video Streaming ──────────────────────────────────────────────────────
    def _stream_video(self, parsed):
        params = parse_qs(parsed.query)
        file_path = params.get('path', [None])[0]
        if not file_path:
            return self._json_error(400, "Missing 'path' parameter")
        file_path = unquote(file_path)
        if not os.path.isfile(file_path):
            return self._json_error(404, f"File not found: {file_path}")

        file_size = os.path.getsize(file_path)
        content_type = mimetypes.guess_type(file_path)[0] or 'video/mp4'

        # Range request support for seeking
        range_header = self.headers.get('Range')
        try:
            if range_header:
                start, end = self._parse_range(range_header, file_size)
                self.send_response(206)
                self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
                self.send_header('Content-Length', str(end - start + 1))
                self.send_header('Content-Type', content_type)
                self.send_header('Accept-Ranges', 'bytes')
                self.end_headers()
                with open(file_path, 'rb') as f:
                    f.seek(start)
                    remaining = end - start + 1
                    while remaining > 0:
                        chunk = f.read(min(65536, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            else:
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(file_size))
                self.send_header('Accept-Ranges', 'bytes')
                self.end_headers()
                with open(file_path, 'rb') as f:
                    while True:
                        chunk = f.read(65536)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass  # Browser cancelled the request — normal during seeking

    def _parse_range(self, range_header, file_size):
        _, range_spec = range_header.split('=', 1)
        start_str, end_str = range_spec.strip().split('-', 1)
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
        end = min(end, file_size - 1)
        return start, end

    # ── API Proxy (GET) ──────────────────────────────────────────────────────
    def _proxy_get(self):
        ai_path = self.path.replace('/api/', '/video/', 1)
        url = f"{AI_SERVER}{ai_path}"
        try:
            req = urllib.request.Request(url, method='GET')
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(data)
        except Exception as e:
            self._json_error(502, f"AI server not reachable: {e}")

    # ── API Proxy (POST) ─────────────────────────────────────────────────────
    def _proxy_post(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b''

        ai_path = self.path.replace('/api/', '/video/', 1)
        url = f"{AI_SERVER}{ai_path}"
        try:
            req = urllib.request.Request(
                url, data=body,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=3600) as resp:
                data = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8', errors='replace')
            self._json_error(e.code, f"AI server error: {error_body}")
        except Exception as e:
            self._json_error(502, f"AI server not reachable: {e}")

    # ── Helpers ──────────────────────────────────────────────────────────────
    def _json_error(self, code, msg):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"error": msg}).encode())

    def log_message(self, format, *args):
        msg = str(args[0]) if args else ''
        if '/api/' in msg or '/stream' in msg:
            print(f"  → {msg}")

ai_process = None

def check_ai_server():
    """Check if AI server is already running."""
    try:
        req = urllib.request.Request(f"{AI_SERVER}/video/health", method='GET')
        with urllib.request.urlopen(req, timeout=3) as resp:
            return resp.status == 200
    except:
        return False

def start_ai_server():
    """Start the AI server — in a Windows Terminal tab if possible, else background."""
    global ai_process
    ai_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    main_py = os.path.join(ai_dir, "main.py")

    if not os.path.exists(main_py):
        print(f"  !! Cannot find {main_py}")
        return False

    # Try venv python first, fall back to system python
    venv_python = os.path.join(ai_dir, "venv", "Scripts", "python.exe")
    python_exe = venv_python if os.path.exists(venv_python) else "python"

    # Try to open in a new Windows Terminal tab
    try:
        subprocess.run(["wt", "--version"], capture_output=True, timeout=3)
        print("  >> Opening AI server in new terminal tab...")
        subprocess.Popen(
            ["wt", "-w", "0", "new-tab", "--title", "AI Server",
             python_exe, main_py],
            cwd=ai_dir,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        # No Windows Terminal — run in background with piped output
        print("  >> Starting AI server in background...")
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        ai_process = subprocess.Popen(
            [python_exe, main_py],
            cwd=ai_dir, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        def stream_output():
            for line in iter(ai_process.stdout.readline, b''):
                text = line.decode('utf-8', errors='replace').rstrip()
                if text:
                    print(f"  [AI] {text}")
        threading.Thread(target=stream_output, daemon=True).start()

    # Wait for server to be ready
    for i in range(30):
        time.sleep(1)
        if check_ai_server():
            print("  >> AI server is ready!")
            return True
    print("  !! AI server didn't start in 30s")
    return False


def main():
    print()
    print("  ╔══════════════════════════════════════════╗")
    print("  ║   Local Scene Manager                    ║")
    print(f"  ║   http://localhost:{PORT}                  ║")
    print("  ╚══════════════════════════════════════════╝")
    print()

    # Auto-start AI server if not running
    if check_ai_server():
        print("  ✅ AI server already running")
    else:
        print("  ⚡ AI server not detected, starting it...")
        start_ai_server()

    print()

    server = HTTPServer(('0.0.0.0', PORT), LocalSceneHandler)

    def open_browser():
        time.sleep(0.8)
        webbrowser.open(f"http://localhost:{PORT}")
    threading.Thread(target=open_browser, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Shutting down...")
        server.shutdown()
        if ai_process:
            print("  Stopping AI server...")
            ai_process.terminate()


if __name__ == '__main__':
    import subprocess
    main()
