"""Local HTTP server for the engine, for `wrangler dev` (set ENGINE_URL=http://127.0.0.1:8788).
Not used in production, where the API reaches the engine through the ENGINE service binding."""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, "src"), os.path.abspath(os.path.join(HERE, "..", ".."))]

from engine import handle  # noqa: E402


class H(BaseHTTPRequestHandler):
    def _go(self, body):
        status, out = handle(self.path.split("?")[0], body)
        data = json.dumps(out).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._go({})

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        self._go(json.loads(self.rfile.read(n) or b"{}"))

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8788
    print(f"engine on http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
