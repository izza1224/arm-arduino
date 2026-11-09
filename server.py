#!/usr/bin/env python3
"""
High-Performance Multi-Threaded Local Server with Reverse Proxy
Bypasses Chrome Private Network Access (PNA) and CORS blocks seamlessly.
"""

import http.server
import urllib.request
import urllib.parse
import urllib.error
import sys
import os

PORT = 8000
WEB_DIR = os.path.dirname(os.path.abspath(__file__))

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        # Proxy endpoint: /proxy?url=http://10.108.123.171/api
        if self.path.startswith("/proxy?url="):
            target_url = urllib.parse.unquote(self.path[len("/proxy?url="):])
            try:
                req = urllib.request.Request(
                    target_url,
                    headers={"User-Agent": "ArmRobotWebTwin/1.0"}
                )
                with urllib.request.urlopen(req, timeout=3.0) as resp:
                    data = resp.read()
                    self.send_response(resp.status)
                    content_type = resp.headers.get("Content-Type", "application/json")
                    self.send_header("Content-Type", content_type)
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("Connection", "close")
                    self.end_headers()
                    self.wfile.write(data)
                    self.wfile.flush()
            except Exception as e:
                err_body = f'{{"error": "{str(e)}"}}\n'.encode("utf-8")
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(err_body)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(err_body)
                self.wfile.flush()
            return

        super().do_GET()

def main():
    server_address = ("", PORT)
    httpd = http.server.ThreadingHTTPServer(server_address, ProxyHandler)
    httpd.daemon_threads = True
    print("=" * 60)
    print(f"  Arm Robot 3D Twin Server & Proxy running on http://localhost:{PORT}/web/")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")
    finally:
        httpd.server_close()

if __name__ == "__main__":
    main()
