from __future__ import annotations

import importlib.util
import json
import sys
import threading
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError

DIRECTORY = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(DIRECTORY))


def load(name):
    spec = importlib.util.spec_from_file_location(name, DIRECTORY / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@contextmanager
def server():
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.respond()

        def do_POST(self):
            self.respond()

        def respond(self):
            size = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(size)
            requests.append((self.path, self.headers.get("Authorization"), body))
            if self.path.endswith("/redirect"):
                self.send_response(302)
                self.send_header("Location", "/credential-sink")
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status": "ok"}')

        def log_message(self, *_args):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=httpd.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_port}", requests
    finally:
        httpd.shutdown()
        httpd.server_close()
        worker.join()


class HttpClientTests(unittest.TestCase):
    def calls(self, url):
        seed = load("seed")
        simulation = load("simulate_sessions")
        return [lambda: seed.post(url, "", {"event_type": "mobile_flow"}, "test-only"),
                lambda: simulation.post(url, {"event_type": "mobile_flow"}, "test-only")]

    def test_api_requests_retain_body_and_authorization(self):
        with server() as (url, requests):
            for call in self.calls(url):
                call()
            self.assertEqual(len(requests), 2)
            self.assertTrue(all(item[1] == "Bearer test-only" for item in requests))
            self.assertTrue(all(json.loads(item[2]) == {"event_type": "mobile_flow"}
                                for item in requests if item[2]))

    def test_file_and_non_http_endpoints_are_rejected(self):
        for url in ("file:///dev/null", "ftp://127.0.0.1/file", "data:text/plain,hello",
                    "http://user:password@localhost", "http://localhost/#fragment"):
            for call in self.calls(url):
                with self.subTest(url=url), self.assertRaises(ValueError):
                    call()

    def test_redirects_never_forward_authorization(self):
        with server() as (url, requests):
            seed_call, simulation_call = self.calls(url + "/redirect")
            self.assertEqual(seed_call()[0], 302)
            with self.assertRaises(HTTPError):
                simulation_call()
            self.assertEqual(len(requests), 2)
            self.assertTrue(all("credential-sink" not in item[0] for item in requests))
