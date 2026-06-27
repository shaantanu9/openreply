"""Reach Connections — backend for the in-app credential flow.

One place that knows every platform OpenReply can reach: its login URL, how to
verify a stored credential (or public reachability) with a live fetch, and the
import/save/delete operations the CLI, MCP, and Tauri IPC all call. Never raises
out of the public functions — each returns a status dict / list so the UI can
render a result instead of an error.

Flow the Connections UI drives:
  1. list_connections() → show a card per platform with status + login_url
  2. user clicks "Open login in browser" → app opens login_url (system browser)
  3. import_browser(source) → extract the session cookie from the browser, store,
     verify  (or save_manual(source, value) when auto-extract fails)
  4. verify_connection(source) → live re-test, flip the badge

Credential kinds drive the UI card:
  "cookie"     → browser-login + import / paste-cookie
  "api_key"    → plain key field
  "login_pair" → two fields (e.g. Bluesky handle + app-password)
  "public"     → no auth needed; the card just shows a live "reachable?" check

`unlocks` (optional) lists the collection source-names a single connection
turns on — e.g. the one ScrapeCreators key unlocks tiktok/instagram/threads/
pinterest. `note` is an optional one-line hint shown on the card.
"""
from __future__ import annotations

import json

from ..core import credentials as _creds
from ..sources import _cookie_extract as _ce

# source -> metadata. `kind` drives the UI card; `query` is the cheap probe used
# by verify. `label` is the human name shown on the card.
GATED: dict[str, dict] = {
    # ── Cookie-gated (authenticated session needed for richer reach) ──
    "reddit": {"login_url": "https://www.reddit.com/login", "kind": "cookie",
               "label": "Reddit", "query": "python"},
    "twitter": {"login_url": "https://x.com/login", "kind": "cookie",
                "label": "X / Twitter", "query": "ai", "unlocks": ["x"]},
    "linkedin": {"login_url": "https://www.linkedin.com/login", "kind": "cookie",
                 "label": "LinkedIn", "query": ""},
    "xiaohongshu": {"login_url": "https://www.xiaohongshu.com", "kind": "cookie",
                    "label": "Xiaohongshu (小红书)", "query": "coffee"},
    "xueqiu": {"login_url": "https://xueqiu.com", "kind": "cookie",
               "label": "Xueqiu (雪球)", "query": "AI"},
    "bilibili": {"login_url": "https://www.bilibili.com", "kind": "cookie",
                 "label": "Bilibili", "query": "python"},
    # ── API-key-gated ──
    "exa_search": {"login_url": "https://dashboard.exa.ai/api-keys", "kind": "api_key",
                   "label": "Exa Search", "query": "ai agents"},
    "scrapecreators": {"login_url": "https://scrapecreators.com", "kind": "api_key",
                       "label": "ScrapeCreators", "query": "ai",
                       "unlocks": ["tiktok", "instagram", "threads", "pinterest"],
                       "note": "One key powers TikTok, Instagram, Threads & Pinterest "
                               "(100 free credits, then pay-as-you-go)."},
    "truthsocial": {"login_url": "https://truthsocial.com", "kind": "api_key",
                    "label": "Truth Social", "query": "news", "unlocks": ["truthsocial"],
                    "note": "Paste the bearer token from truthsocial.com → DevTools → "
                            "Network tab (Authorization header)."},
    # ── Login-pair (two fields: identifier + secret) ──
    "bluesky": {"login_url": "https://bsky.app/settings/app-passwords", "kind": "login_pair",
                "label": "Bluesky", "query": "ai", "unlocks": ["bluesky"],
                "field_a": "handle", "field_b": "app_password",
                "label_a": "Handle", "label_b": "App password",
                "note": "Free + instant: bsky.app → Settings → App Passwords."},
    # ── Public (no auth needed — the card shows a live reachability check) ──
    "hackernews": {"login_url": "", "kind": "public",
                   "label": "Hacker News", "query": "ai"},
    "devto": {"login_url": "", "kind": "public",
              "label": "Dev.to", "query": "javascript"},
    "mastodon": {"login_url": "", "kind": "public",
                 "label": "Mastodon", "query": "python", "unlocks": ["mastodon"]},
    "youtube": {"login_url": "", "kind": "public",
                "label": "YouTube", "query": "ai", "unlocks": ["youtube"],
                "note": "Keyless via yt-dlp — no login needed."},
}

# Connection source-name → collection source-names it feeds. Used to auto-include
# connected+enabled social sources in a collect run. A connection without an
# `unlocks` entry maps to itself.
def _unlocks(source: str) -> list[str]:
    return GATED.get(source, {}).get("unlocks", [source])


def _live_check(source: str) -> tuple[bool, str]:
    """Issue a cheap real fetch for *source*. Returns (ok, message)."""
    meta = GATED.get(source)
    if not meta:
        return False, f"unknown source '{source}'"
    q = meta.get("query") or "ai"
    try:
        if source == "reddit":
            from ..sources.reddit_free import fetch_reddit_free
            rows = fetch_reddit_free(q, limit=3)
        elif source == "twitter":
            from ..sources.x_twitter import fetch_x
            rows = [r for r in fetch_x(q, limit=3) if not r.get("_error")]
        elif source == "xiaohongshu":
            from ..sources.xiaohongshu import fetch_xiaohongshu
            rows = fetch_xiaohongshu(q, limit=3)
        elif source == "linkedin":
            return (_creds.has_credential("linkedin"),
                    "Cookie stored (LinkedIn deep fetch needs the MCP)")
        elif source == "xueqiu":
            from ..sources.xueqiu import fetch_xueqiu
            rows = fetch_xueqiu(q, limit=3)
        elif source == "bilibili":
            from ..sources.bilibili import fetch_bilibili
            rows = fetch_bilibili(q, limit=3)
        elif source == "exa_search":
            from ..sources.exa_search import fetch_exa_search
            rows = fetch_exa_search(q, limit=3)
        elif source == "scrapecreators":
            # The one key powers 4 platforms; probe the cheapest (TikTok search).
            from ..sources.tiktok import fetch_tiktok
            rows = [r for r in fetch_tiktok(q, limit=3) if not (isinstance(r, dict) and r.get("_error"))]
        elif source == "truthsocial":
            from ..sources.truthsocial import fetch_truthsocial
            rows = [r for r in fetch_truthsocial(q, limit=3) if not (isinstance(r, dict) and r.get("_error"))]
        elif source == "youtube":
            from ..sources.youtube import search_youtube_videos
            rows = search_youtube_videos(q, limit=3)
        elif source == "hackernews":
            from ..sources.hackernews import fetch_hn
            rows = fetch_hn(q, limit=3)
        elif source == "devto":
            from ..sources.devto import fetch_devto
            rows = fetch_devto(q, limit=3)
        elif source == "bluesky":
            from ..sources.bluesky import fetch_bluesky
            rows = fetch_bluesky(q, limit=3)
        elif source == "mastodon":
            from ..sources.mastodon import fetch_mastodon
            rows = fetch_mastodon(q, limit=3)
        else:
            return False, f"unknown source '{source}'"
    except Exception as e:  # never raise
        return False, f"check failed: {e}"
    rows = [r for r in (rows or []) if not (isinstance(r, dict) and r.get("_error"))]
    if rows:
        return True, f"OK — {len(rows)} rows"
    if meta.get("kind") == "public":
        return False, "no rows (source unreachable or rate-limited)"
    return False, "no rows (credential missing, expired, or blocked)"


def list_connections() -> list[dict]:
    """Status of every reachable platform for the Reach Connections UI."""
    out: list[dict] = []
    for source, meta in GATED.items():
        kind = meta["kind"]
        cred = _creds.get_credential(source)
        # Public sources need no credential — they're always "ready"; the user
        # can still run a live check. Cookie/api_key sources are "connected"
        # only when a credential is stored.
        connected = True if kind == "public" else (cred is not None)
        out.append({
            "source": source,
            "label": meta["label"],
            "kind": kind,
            "login_url": meta["login_url"],
            "connected": connected,
            "username": (cred or {}).get("username") or "",
            "last_verified_at": (cred or {}).get("last_verified_at"),
            # "Use in collection" toggle — defaults on; public sources default
            # on too (free) but can be muted.
            "enabled": _creds.is_enabled(source, default=True),
            "unlocks": meta.get("unlocks", [source]),
            "note": meta.get("note", ""),
            "label_a": meta.get("label_a", ""),
            "label_b": meta.get("label_b", ""),
            "field_a": meta.get("field_a", ""),
            "field_b": meta.get("field_b", ""),
        })
    return out


def verify_connection(source: str) -> dict:
    """Live-test a source's credential and stamp last_verified_at on success."""
    ok, msg = _live_check(source)
    meta = GATED.get(source, {})
    if ok and meta.get("kind") != "public":
        _creds.mark_verified(source)
    return {"source": source, "connected": ok, "message": msg,
            "kind": meta.get("kind", ""),
            "username": (_creds.get_credential(source) or {}).get("username", "")}


def import_browser(source: str, browser: str | None = None) -> dict:
    """Extract *source*'s session cookie from the local browser, store, verify."""
    if source not in GATED:
        return {"source": source, "connected": False, "message": f"unknown source '{source}'"}
    kind = GATED[source]["kind"]
    if kind == "public":
        return {"source": source, "connected": True,
                "message": "no login needed — this source is public"}
    if kind != "cookie":
        return {"source": source, "connected": False,
                "message": "this source is key/credential-based — use save_manual (paste)"}
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
    kind = GATED[source]["kind"]
    if kind == "public":
        return {"source": source, "connected": True,
                "message": "no credential needed — this source is public"}
    value = (value or "").strip()
    if not value:
        return {"source": source, "connected": False, "message": "empty value"}
    if kind == "api_key":
        _creds.set_credential(source, {"api_key": value}, kind="api_key")
        return verify_connection(source)
    if kind == "login_pair":
        meta = GATED[source]
        fa, fb = meta.get("field_a", "field_a"), meta.get("field_b", "field_b")
        pair = _parse_login_pair(value, fa, fb)
        if not pair.get(fa) or not pair.get(fb):
            return {"source": source, "connected": False,
                    "message": f"need both {meta.get('label_a', fa)} and "
                               f"{meta.get('label_b', fb)}"}
        _creds.set_credential(source, pair, username=pair.get(fa, ""), kind="login_pair")
        return verify_connection(source)
    cookies = _parse_cookie_value(value)
    if not cookies:
        return {"source": source, "connected": False,
                "message": "could not parse cookie string (expected 'name=value; ...')"}
    _creds.set_credential(source, cookies, kind="cookie")
    return verify_connection(source)


def delete_connection(source: str) -> dict:
    if source in GATED and GATED[source]["kind"] == "public":
        return {"source": source, "connected": True,
                "message": "public source — nothing to disconnect"}
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


def _parse_login_pair(value: str, field_a: str, field_b: str) -> dict:
    """Parse a two-field credential. Accepts a JSON object with the field keys
    (preferred — what the UI sends) or a plain 'a:b' / 'a / b' string."""
    try:
        obj = json.loads(value)
        if isinstance(obj, dict):
            return {field_a: str(obj.get(field_a, "")).strip(),
                    field_b: str(obj.get(field_b, "")).strip()}
    except Exception:
        pass
    # Fallback: split on the first ':' or whitespace-slash-whitespace.
    sep = ":" if ":" in value else None
    a, b = (value.split(sep, 1) + [""])[:2] if sep else (value, "")
    return {field_a: a.strip(), field_b: b.strip()}


def toggle_connection(source: str, enabled: bool) -> dict:
    """Set whether *source* is included in collection runs. Returns its status."""
    if source not in GATED:
        return {"source": source, "connected": False, "enabled": False,
                "message": f"unknown source '{source}'"}
    _creds.set_enabled(source, enabled)
    cred = _creds.get_credential(source)
    connected = True if GATED[source]["kind"] == "public" else (cred is not None)
    return {"source": source, "connected": connected,
            "enabled": _creds.is_enabled(source, default=True),
            "message": "will be used in collection" if enabled else "muted from collection"}


def connected_collection_sources() -> list[str]:
    """CLI source-names to auto-include in a collect run: every connection that
    is both connected (credential present, or public) AND enabled, expanded via
    its `unlocks` map. Deduped, order-stable. Never raises."""
    out: list[str] = []
    seen: set[str] = set()
    try:
        # Only emit names the collect dispatcher actually knows. Reddit (core,
        # collected separately) and exa_search (no posts adapter) have no entry
        # and are skipped, so we never inject an "unknown source" error.
        from ..sources.collect_adapter import SOURCES as _DISPATCH
        for source, meta in GATED.items():
            kind = meta["kind"]
            connected = True if kind == "public" else _creds.has_credential(source)
            if not connected:
                continue
            if not _creds.is_enabled(source, default=True):
                continue
            for cli_name in _unlocks(source):
                if cli_name in _DISPATCH and cli_name not in seen:
                    seen.add(cli_name)
                    out.append(cli_name)
    except Exception:
        return out
    return out
