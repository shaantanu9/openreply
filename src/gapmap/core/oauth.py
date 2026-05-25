"""One-shot OAuth code catcher on localhost — used by `auth login`.

Flow:
  1. Build Reddit auth URL with random state + scopes.
  2. Open browser to it.
  3. Spin up a tiny HTTP server on the redirect port (default 8080).
  4. Reddit redirects the user to http://localhost:8080?state=...&code=...
  5. Capture the code, exchange it for a refresh_token via PRAW.
"""
from __future__ import annotations

import secrets
import threading
import webbrowser
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

from .client import get_reddit_unauthed

DEFAULT_SCOPES = [
    "identity",
    "read",
    "history",
    "mysubreddits",
]


@dataclass
class _CaughtCode:
    state: str | None = None
    code: str | None = None
    error: str | None = None


def _make_handler(caught: _CaughtCode):
    class _Handler(BaseHTTPRequestHandler):
        def log_message(self, *_: object) -> None:  # silence default access log
            pass

        def do_GET(self) -> None:  # noqa: N802
            q = parse_qs(urlparse(self.path).query)
            caught.state = (q.get("state") or [None])[0]
            caught.code = (q.get("code") or [None])[0]
            caught.error = (q.get("error") or [None])[0]

            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            if caught.error:
                body = f"<h2>Authorization failed: {caught.error}</h2>"
            elif caught.code:
                body = "<h2>Authorization complete.</h2><p>You can close this tab.</p>"
            else:
                body = "<h2>No code in response.</h2>"
            self.wfile.write(body.encode("utf-8"))

    return _Handler


def run_oauth_flow(
    scopes: list[str] | None = None,
    port: int = 8080,
    open_browser: bool = True,
) -> str:
    """Return a fresh refresh_token. Blocks until the user completes the redirect."""
    reddit = get_reddit_unauthed()
    state = secrets.token_urlsafe(16)
    auth_url = reddit.auth.url(
        scopes=scopes or DEFAULT_SCOPES,
        state=state,
        duration="permanent",
    )

    caught = _CaughtCode()
    server = HTTPServer(("localhost", port), _make_handler(caught))
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    print(f"\nOpen this URL in your browser to authorize:\n  {auth_url}\n")
    if open_browser:
        try:
            webbrowser.open(auth_url)
        except Exception:
            pass

    try:
        # Block until we've caught one request.
        while caught.code is None and caught.error is None:
            t.join(timeout=0.2)
            if not t.is_alive():
                break
    finally:
        server.shutdown()
        server.server_close()

    if caught.error:
        raise RuntimeError(f"OAuth error: {caught.error}")
    if caught.state != state:
        raise RuntimeError("OAuth state mismatch — aborting.")
    if not caught.code:
        raise RuntimeError("No authorization code received.")

    refresh_token = reddit.auth.authorize(caught.code)
    if not refresh_token:
        raise RuntimeError("Reddit returned no refresh token. Use duration=permanent.")
    return refresh_token
