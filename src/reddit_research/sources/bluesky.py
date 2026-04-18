"""Bluesky public search via AT Protocol.

⚠ As of mid-2026 the `public.api.bsky.app` endpoint returns 403 for
anonymous clients — Bluesky tightened rate limits and effectively requires
an app-password session. This adapter degrades to empty gracefully. To
enable, set BSKY_HANDLE + BSKY_APP_PASSWORD env vars (future work).

https://docs.bsky.app/docs/api/app-bsky-feed-search-posts
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

_BASE = "https://public.api.bsky.app/xrpc"


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
    collected: list[dict] = []
    cursor: str | None = None
    while len(collected) < limit:
        params: dict[str, Any] = {"q": query, "limit": min(100, limit - len(collected))}
        if cursor:
            params["cursor"] = cursor
        try:
            r = httpx.get(f"{_BASE}/app.bsky.feed.searchPosts", params=params, timeout=20)
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
