"""Offline check that redirects are refused (local server on 127.0.0.1, no network, no token).

  engine/.venv/Scripts/python -I tools/shadow_trial/test_no_redirect.py
"""
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from safe_http import build_opener  # noqa: E402

import urllib.request  # noqa: E402

seen = []


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        seen.append((self.path, self.headers.get("Authorization")))
        if self.path == "/start":
            self.send_response(302)
            self.send_header("Location", "/target")
            self.end_headers()
        else:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"{}")

    def log_message(self, *a):
        pass


srv = HTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_port}"
hdr = {"Authorization": "Bearer FAKE-TEST-TOKEN"}

# default urllib follows the redirect and forwards the header on same-host redirects (shows the risk)
urllib.request.urlopen(urllib.request.Request(base + "/start", headers=hdr)).read()
default_forwarded = [p for p, a in seen if p == "/target" and a]
seen.clear()

try:
    build_opener().open(urllib.request.Request(base + "/start", headers=hdr)).read()
    raise SystemExit("FAIL: redirect was followed")
except RuntimeError as e:
    assert str(e) == "HTTP 302 redirect refused", "message should name the status code only"
assert [p for p, _ in seen] == ["/start"], f"unexpected requests: {seen}"
assert build_opener().open(urllib.request.Request(base + "/ok", headers=hdr)).status == 200
print("OK: redirect refused, only the original URL requested, normal 200 still works "
      f"(default handler forwarded the header on {len(default_forwarded)} redirected request)")
