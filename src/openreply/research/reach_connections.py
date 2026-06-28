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

# Plain-language "what connecting this gets you" — shown on each Connections card
# so the value is obvious. Honest about limits (Reddit cookie is best-effort).
USES: dict[str, str] = {
    "reddit": ("Pulls Reddit threads into your corpus & opportunities. Cookie login "
               "is best-effort — Reddit often blocks it and falls back to public RSS "
               "(no scores/comments). For full search, scores, comments & history, add "
               "Reddit API keys in Settings → Reddit."),
    "twitter": "Search X/Twitter for reply opportunities and post tweets & threads from Compose.",
    "linkedin": "Read a specific LinkedIn profile/company post by URL (no keyword search).",
    "xiaohongshu": "Fetch Xiaohongshu (小红书) posts into your corpus.",
    "xueqiu": "Fetch Xueqiu (雪球) fintech posts into your corpus.",
    "bilibili": "Fetch Bilibili videos/posts into your corpus.",
    "exa_search": "Higher-quality web & news search for discovery.",
    "scrapecreators": "Unlocks TikTok, Instagram, Threads & Pinterest fetching with one key.",
    "truthsocial": "Fetch Truth Social posts into your corpus.",
    "bluesky": "Search Bluesky and pull posts into your corpus + opportunities.",
    "hackernews": "Always on — pulls Hacker News discussions into your corpus.",
    "devto": "Always on — pulls Dev.to articles into your corpus.",
    "mastodon": "Always on — pulls Mastodon posts into your corpus.",
    "youtube": "Always on — pulls YouTube transcripts & comments (yt-dlp).",
}


# Connection source-name → collection source-names it feeds. Used to auto-include
# connected+enabled social sources in a collect run. A connection without an
# `unlocks` entry maps to itself.
def _unlocks(source: str) -> list[str]:
    return GATED.get(source, {}).get("unlocks", [source])


def _fetch_rows(source: str, query: str, limit: int) -> list[dict]:
    """Run the source's real fetcher and return clean rows (errors filtered).
    Never raises — returns [] on any failure. LinkedIn has no topic-search
    (URL-reader only) so it returns []. Shared by verify + preview."""
    try:
        if source == "reddit":
            from ..sources.reddit_free import fetch_reddit_free
            rows = fetch_reddit_free(query, limit=limit)
        elif source == "twitter":
            from ..sources.x_twitter import fetch_x
            rows = fetch_x(query, limit=limit)
        elif source == "xiaohongshu":
            from ..sources.xiaohongshu import fetch_xiaohongshu
            rows = fetch_xiaohongshu(query, limit=limit)
        elif source == "linkedin":
            return []  # URL-reader only — no topic search to preview
        elif source == "xueqiu":
            from ..sources.xueqiu import fetch_xueqiu
            rows = fetch_xueqiu(query, limit=limit)
        elif source == "bilibili":
            from ..sources.bilibili import fetch_bilibili
            rows = fetch_bilibili(query, limit=limit)
        elif source == "exa_search":
            from ..sources.exa_search import fetch_exa_search
            rows = fetch_exa_search(query, limit=limit)
        elif source == "scrapecreators":
            # The one key powers 4 platforms; probe the cheapest (TikTok search).
            from ..sources.tiktok import fetch_tiktok
            rows = fetch_tiktok(query, limit=limit)
        elif source == "truthsocial":
            from ..sources.truthsocial import fetch_truthsocial
            rows = fetch_truthsocial(query, limit=limit)
        elif source == "youtube":
            from ..sources.youtube import search_youtube_videos
            rows = search_youtube_videos(query, limit=limit)
        elif source == "hackernews":
            from ..sources.hackernews import fetch_hn
            rows = fetch_hn(query, limit=limit)
        elif source == "devto":
            from ..sources.devto import fetch_devto
            rows = fetch_devto(query, limit=limit)
        elif source == "bluesky":
            from ..sources.bluesky import fetch_bluesky
            rows = fetch_bluesky(query, limit=limit)
        elif source == "mastodon":
            from ..sources.mastodon import fetch_mastodon
            rows = fetch_mastodon(query, limit=limit)
        else:
            return []
    except Exception:
        return []
    return [r for r in (rows or []) if not (isinstance(r, dict) and r.get("_error"))]


def _live_check(source: str) -> tuple[bool, str]:
    """Issue a cheap real fetch for *source*. Returns (ok, message)."""
    meta = GATED.get(source)
    if not meta:
        return False, f"unknown source '{source}'"
    if source == "linkedin":
        return (_creds.has_credential("linkedin"),
                "Cookie stored (LinkedIn deep fetch needs the MCP)")
    rows = _fetch_rows(source, meta.get("query") or "ai", 3)
    if rows:
        return True, f"OK — {len(rows)} rows"
    if meta.get("kind") == "public":
        return False, "no rows (source unreachable or rate-limited)"
    return False, "no rows (credential missing, expired, or blocked)"


def _preview_item(r: dict) -> dict:
    """Normalize a fetched row into a compact, link-clickable preview item."""
    title = (r.get("title") or "").strip()
    body = (r.get("selftext") or r.get("body") or "").strip()
    if not title:
        title = (body[:120] + ("…" if len(body) > 120 else "")) or "(untitled)"
    return {
        "title": title[:240],
        "url": r.get("url") or r.get("permalink") or "",
        "author": r.get("author") or "",
        "score": r.get("score"),
        "comments": r.get("num_comments"),
        "source_type": r.get("source_type") or r.get("sub") or "",
        "snippet": body[:280],
    }


def preview_source(source: str, query: str | None = None, limit: int = 6) -> dict:
    """Run a real fetch and return a SAMPLE of the actual content (titles, links,
    authors, scores) so the UI can show "this is what we'd pull" in a modal.
    Never raises. For credentialed sources this also proves the credential works."""
    meta = GATED.get(source)
    if not meta:
        return {"source": source, "ok": False, "message": f"unknown source '{source}'", "items": []}
    q = (query or meta.get("query") or "ai").strip()
    if source == "linkedin":
        return {"source": source, "label": meta.get("label", source), "query": q,
                "ok": _creds.has_credential("linkedin"), "items": [],
                "message": "LinkedIn is a URL reader — paste a profile/company URL to fetch; no topic search."}
    items = [_preview_item(r) for r in _fetch_rows(source, q, max(1, min(limit, 15)))]
    ok = bool(items)
    if ok and meta.get("kind") != "public":
        _creds.mark_verified(source)
    msg = (f"Fetched {len(items)} item(s) for “{q}”." if ok
           else ("Source reachable but returned nothing — try a different query."
                 if meta.get("kind") == "public"
                 else "No results — connect/verify the credential first."))
    return {"source": source, "label": meta.get("label", source), "query": q,
            "kind": meta.get("kind", ""), "ok": ok, "count": len(items),
            "message": msg, "items": items, "unlocks": meta.get("unlocks", [source])}


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
            "uses": USES.get(source, ""),
            "note": meta.get("note", ""),
            # Exact session-cookie names to paste (cookie sources) — drives the
            # "Paste auth_token, ct0" hint in the manual-paste modal.
            "need": _ce.required_cookies(source) if kind == "cookie" else [],
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
        need = _ce.required_cookies(source)
        present = _ce.browsers_present()
        label = GATED[source]["label"]
        login = GATED[source].get("login_url", "")
        reason = _ce.diagnose_last()           # precise cause from the last attempt
        cookie_list = ", ".join(need) or "the session cookie"
        return {
            "source": source, "connected": False,
            "need": need, "browsers": present, "login_url": login, "reason": reason,
            "message": (
                f"Couldn't auto-import {label} cookies — {reason}. "
                f"Paste {cookie_list} manually via the Cookie-Editor browser extension → Export."
            ),
        }
    _creds.set_credential(source, cookies, kind="cookie")
    return verify_connection(source)


def connect_help(source: str) -> dict:
    """What the UI needs to guide a connection: required cookie names, login URL,
    which browsers are present, and the manual-paste hint. Never raises."""
    meta = GATED.get(source, {})
    return {
        "source": source,
        "label": meta.get("label", source),
        "kind": meta.get("kind", ""),
        "login_url": meta.get("login_url", ""),
        "need": _ce.required_cookies(source),
        "browsers": _ce.browsers_present(),
        "note": meta.get("note", ""),
    }


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
