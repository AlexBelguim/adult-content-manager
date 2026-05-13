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


def main():
    server = HTTPServer(('0.0.0.0', PORT), LocalSceneHandler)
    print()
    print("  ╔══════════════════════════════════════════╗")
    print("  ║   Local Scene Manager                    ║")
    print(f"  ║   http://localhost:{PORT}                  ║")
    print(f"  ║   AI Server: {AI_SERVER}         ║")
    print("  ╚══════════════════════════════════════════╝")
    print()
    print("  Make sure Run_AI.bat is running!")
    print()

    def open_browser():
        time.sleep(0.8)
        webbrowser.open(f"http://localhost:{PORT}")
    threading.Thread(target=open_browser, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Shutting down...")
        server.shutdown()


if __name__ == '__main__':
    main()
