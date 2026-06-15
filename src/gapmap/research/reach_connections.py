"""Reach Connections — backend for the in-app credential flow.

One place that knows every cookie/key-gated source: its login URL, how to verify
a stored credential with a live fetch, and the import/save/delete operations the
CLI, MCP, and Tauri IPC all call. Never raises out of the public functions —
each returns a status dict / list so the UI can render a result instead of an
error.

Flow the UI drives:
  1. list_connections() → show a card per source with status + login_url
  2. user clicks "Open login in browser" → app opens login_url (system browser)
  3. import_browser(source) → extract the session cookie from the browser, store,
     verify  (or save_manual(source, value) when auto-extract fails)
  4. verify_connection(source) → live re-test, flip the badge
"""
from __future__ import annotations

import json

from ..core import credentials as _creds
from ..sources import _cookie_extract as _ce

# source -> (login_url, kind, verify_query). kind drives the UI card:
#   "cookie"  → browser-login + import/paste
#   "api_key" → plain key field
GATED: dict[str, dict] = {
    "reddit": {"login_url": "https://www.reddit.com/login", "kind": "cookie",
               "label": "Reddit", "query": "python"},
    "twitter": {"login_url": "https://x.com/login", "kind": "cookie",
                "label": "X / Twitter", "query": "ai"},
    "xiaohongshu": {"login_url": "https://www.xiaohongshu.com", "kind": "cookie",
                    "label": "Xiaohongshu (小红书)", "query": "coffee"},
    "linkedin": {"login_url": "https://www.linkedin.com/login", "kind": "cookie",
                 "label": "LinkedIn", "query": ""},
    "xueqiu": {"login_url": "https://xueqiu.com", "kind": "cookie",
               "label": "Xueqiu (雪球)", "query": "AI"},
    "bilibili": {"login_url": "https://www.bilibili.com", "kind": "cookie",
                 "label": "Bilibili", "query": "python"},
    "exa_search": {"login_url": "https://dashboard.exa.ai/api-keys", "kind": "api_key",
                   "label": "Exa Search", "query": "ai agents"},
}


def _live_check(source: str) -> tuple[bool, str]:
    """Issue a cheap real fetch for *source*. Returns (ok, message)."""
    try:
        if source == "reddit":
            from ..sources.reddit_free import fetch_reddit_free
            rows = fetch_reddit_free("python", limit=3)
        elif source == "twitter":
            from ..sources.x_twitter import fetch_x
            rows = [r for r in fetch_x("ai", limit=3) if not r.get("_error")]
        elif source == "xiaohongshu":
            from ..sources.xiaohongshu import fetch_xiaohongshu
            rows = fetch_xiaohongshu("coffee", limit=3)
        elif source == "linkedin":
            return (_creds.has_credential("linkedin"),
                    "Cookie stored (LinkedIn deep fetch needs the MCP)")
        elif source == "xueqiu":
            from ..sources.xueqiu import fetch_xueqiu
            rows = fetch_xueqiu("AI", limit=3)
        elif source == "bilibili":
            from ..sources.bilibili import fetch_bilibili
            rows = fetch_bilibili("python", limit=3)
        elif source == "exa_search":
            from ..sources.exa_search import fetch_exa_search
            rows = fetch_exa_search("ai agents", limit=3)
        else:
            return False, f"unknown source '{source}'"
    except Exception as e:  # never raise
        return False, f"check failed: {e}"
    if rows:
        return True, f"OK — {len(rows)} rows"
    return False, "no rows (credential missing, expired, or blocked)"


def list_connections() -> list[dict]:
    """Status of every gated source for the Reach Connections UI."""
    out: list[dict] = []
    for source, meta in GATED.items():
        cred = _creds.get_credential(source)
        out.append({
            "source": source,
            "label": meta["label"],
            "kind": meta["kind"],
            "login_url": meta["login_url"],
            "connected": cred is not None,
            "username": (cred or {}).get("username") or "",
            "last_verified_at": (cred or {}).get("last_verified_at"),
        })
    return out


def verify_connection(source: str) -> dict:
    """Live-test a source's credential and stamp last_verified_at on success."""
    ok, msg = _live_check(source)
    if ok:
        _creds.mark_verified(source)
    return {"source": source, "connected": ok, "message": msg,
            "username": (_creds.get_credential(source) or {}).get("username", "")}


def import_browser(source: str, browser: str | None = None) -> dict:
    """Extract *source*'s session cookie from the local browser, store, verify."""
    if source not in GATED:
        return {"source": source, "connected": False, "message": f"unknown source '{source}'"}
    if GATED[source]["kind"] != "cookie":
        return {"source": source, "connected": False,
                "message": "this source uses an API key — use save_manual"}
    cookies = _ce.extract_cookies(source, browser=browser)
    if not cookies:
        return {"source": source, "connected": False,
                "message": ("No cookies found in your browser. Log into the site first, "
                            "or use the manual paste option (Cookie-Editor).")}
    _creds.set_credential(source, cookies, kind="cookie")
    return verify_connection(source)


def save_manual(source: str, value: str) -> dict:
    """Store a manually-provided credential. For cookie sources, `value` is a
    'name=value; name2=value2' string (or JSON map); for api_key sources it's the key."""
    if source not in GATED:
        return {"source": source, "connected": False, "message": f"unknown source '{source}'"}
    value = (value or "").strip()
    if not value:
        return {"source": source, "connected": False, "message": "empty value"}
    if GATED[source]["kind"] == "api_key":
        _creds.set_credential(source, {"api_key": value}, kind="api_key")
        return verify_connection(source)
    cookies = _parse_cookie_value(value)
    if not cookies:
        return {"source": source, "connected": False,
                "message": "could not parse cookie string (expected 'name=value; ...')"}
    _creds.set_credential(source, cookies, kind="cookie")
    return verify_connection(source)


def delete_connection(source: str) -> dict:
    _creds.delete_credential(source)
    return {"source": source, "connected": False, "message": "disconnected"}


def _parse_cookie_value(value: str) -> dict:
    """Accept either a JSON object or a 'k=v; k2=v2' cookie header string."""
    try:
        obj = json.loads(value)
        if isinstance(obj, dict) and obj:
            return {str(k): str(v) for k, v in obj.items()}
    except Exception:
        pass
    cookies: dict[str, str] = {}
    for pair in value.split(";"):
        pair = pair.strip()
        if "=" in pair:
            k, _, v = pair.partition("=")
            k = k.strip()
            if k:
                cookies[k] = v.strip()
    return cookies
