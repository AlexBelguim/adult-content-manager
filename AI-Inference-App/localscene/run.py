"""
Local Scene Manager — Standalone test tool
Serves a web UI on port 8899 that talks directly to the AI server (port 3344).
No Node.js backend needed. Just run this + Run_AI.bat.

Usage:
    python localscene/run.py
    Then open http://localhost:8899
"""
import os
import sys
import json
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import threading

PORT = 8899
AI_SERVER = "http://localhost:3344"

class LocalSceneHandler(SimpleHTTPRequestHandler):
    """Serves the local HTML UI and proxies API calls to the AI server."""

    def __init__(self, *args, **kwargs):
        # Serve files from the localscene directory
        super().__init__(*args, directory=os.path.dirname(os.path.abspath(__file__)), **kwargs)

    def do_GET(self):
        if self.path == '/' or self.path == '':
            self.path = '/index.html'
        super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/'):
            self._proxy_to_ai_server()
        else:
            self.send_error(404)

    def _proxy_to_ai_server(self):
        """Proxy API calls to the AI Flask server."""
        import urllib.request
        import urllib.error

        # Read request body
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b''

        # Map /api/xxx to AI server /video/xxx
        ai_path = self.path.replace('/api/', '/video/')
        url = f"{AI_SERVER}{ai_path}"

        try:
            req = urllib.request.Request(
                url, data=body,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=3600) as resp:
                result = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(result)
        except urllib.error.URLError as e:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "error": f"AI server not reachable: {e}",
                "hint": "Make sure Run_AI.bat is running"
            }).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        # Quieter logging
        if '/api/' in str(args[0]) if args else False:
            print(f"[LocalScene] {args[0]}")


def main():
    server = HTTPServer(('0.0.0.0', PORT), LocalSceneHandler)
    print(f"╔══════════════════════════════════════════╗")
    print(f"║   Local Scene Manager                    ║")
    print(f"║   http://localhost:{PORT}                  ║")
    print(f"║   AI Server: {AI_SERVER}         ║")
    print(f"╚══════════════════════════════════════════╝")

    # Open browser after short delay
    def open_browser():
        import time
        time.sleep(1)
        webbrowser.open(f"http://localhost:{PORT}")
    threading.Thread(target=open_browser, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == '__main__':
    main()
