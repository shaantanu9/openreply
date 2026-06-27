"""Bluesky search via AT Protocol.

The anonymous `public.api.bsky.app` endpoint returns 403 as of mid-2026, but an
**app password** restores full search — it's free + instant (bsky.app →
Settings → App Passwords; no approval, unlike Reddit). Set BSKY_HANDLE +
BSKY_APP_PASSWORD (e.g. via Settings → BYOK) and this authenticates a session
and queries the authenticated searchPosts endpoint. Without creds it degrades
to empty gracefully.

https://docs.bsky.app/docs/api/app-bsky-feed-search-posts
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import httpx

_BASE = "https://public.api.bsky.app/xrpc"
_AUTH_BASE = "https://bsky.social/xrpc"


def _creds() -> tuple[str, str]:
    """Return (handle, app_password) from the Reach Connections store first
    (Connections UI saves them under source "bluesky"), then env. Never raises."""
    try:
        from ..core.credentials import get_credential
        cred = get_credential("bluesky")
        if cred:
            cookies = cred.get("cookies") or {}
            handle = str(cookies.get("handle") or "").strip()
            pw = str(cookies.get("app_password") or "").strip()
            if handle and pw:
                return handle, pw
    except Exception:
        pass
    return (os.getenv("BSKY_HANDLE") or "").strip(), (os.getenv("BSKY_APP_PASSWORD") or "").strip()


def _session() -> str | None:
    """Create an AT-proto session from the stored handle + app-password.
    Returns the accessJwt, or None if creds are absent / login fails."""
    handle, pw = _creds()
    if not handle or not pw:
        return None
    try:
        r = httpx.post(
            f"{_AUTH_BASE}/com.atproto.server.createSession",
            json={"identifier": handle, "password": pw},
            timeout=20,
        )
        r.raise_for_status()
        return (r.json() or {}).get("accessJwt")
    except httpx.HTTPError:
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(p: dict[str, Any]) -> dict[str, Any]:
    record = p.get("record") or {}
    author = p.get("author") or {}
    try:
        ts = datetime.fromisoformat((record.get("createdAt") or "").replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        ts = 0.0
    # Build the deep-link to the post
    uri = p.get("uri") or ""
    # at://did:plc:xxx/app.bsky.feed.post/yyy → https://bsky.app/profile/<handle>/post/yyy
    rkey = uri.split("/")[-1] if "/" in uri else uri
    handle = author.get("handle") or author.get("did") or "?"
    permalink = f"https://bsky.app/profile/{handle}/post/{rkey}"
    return {
        "id": f"bsky_{uri.replace('/', '_')}",
        "sub": "bluesky",
        "source_type": "bluesky",
        "author": handle,
        "title": "",
        "selftext": (record.get("text") or "")[:2000],
        "url": permalink,
        "score": int(p.get("likeCount") or 0),
        "upvote_ratio": None,
        "num_comments": int(p.get("replyCount") or 0),
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": None,
        "permalink": permalink,
        "fetched_at": _now_iso(),
    }


def fetch_bluesky(query: str, limit: int = 50) -> list[dict]:
    jwt = _session()
    if not jwt:
        return []  # no app password → anonymous search is 403-blocked
    headers = {"Authorization": f"Bearer {jwt}"}
    collected: list[dict] = []
    cursor: str | None = None
    while len(collected) < limit:
        params: dict[str, Any] = {"q": query, "limit": min(100, limit - len(collected))}
        if cursor:
            params["cursor"] = cursor
        try:
            r = httpx.get(
                f"{_AUTH_BASE}/app.bsky.feed.searchPosts",
                params=params, headers=headers, timeout=20,
            )
            r.raise_for_status()
        except httpx.HTTPError:
            break
        data = r.json() or {}
        posts = data.get("posts") or []
        if not posts:
            break
        collected.extend(_row(p) for p in posts)
        cursor = data.get("cursor")
        if not cursor:
            break
    return collected[:limit]
