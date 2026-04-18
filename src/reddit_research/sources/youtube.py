"""YouTube comments via YouTube Data API v3. Requires free YOUTUBE_API_KEY.

1. Create a Google Cloud project + enable YouTube Data API v3
2. Create an API key, set YOUTUBE_API_KEY in env
3. Free quota: 10,000 units/day (search=100 units, comment fetch=1 unit each)

Degrades gracefully to a single-element error list if no key is set.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import httpx

_BASE = "https://www.googleapis.com/youtube/v3"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _require_key() -> str | None:
    return os.getenv("YOUTUBE_API_KEY") or None


def search_youtube_videos(query: str, limit: int = 10) -> list[dict]:
    key = _require_key()
    if not key:
        return [{"_error": "YOUTUBE_API_KEY not set"}]
    try:
        r = httpx.get(
            f"{_BASE}/search",
            params={
                "key": key, "q": query, "part": "snippet", "type": "video",
                "maxResults": min(50, limit), "order": "relevance",
            },
            timeout=20,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    items = (r.json() or {}).get("items") or []
    return [
        {
            "video_id": i.get("id", {}).get("videoId"),
            "title": (i.get("snippet") or {}).get("title"),
            "channel": (i.get("snippet") or {}).get("channelTitle"),
            "published": (i.get("snippet") or {}).get("publishedAt"),
        }
        for i in items
    ]


def _comment_row(c: dict[str, Any], video_id: str, video_title: str) -> dict[str, Any]:
    top = (c.get("snippet") or {}).get("topLevelComment", {}).get("snippet") or {}
    try:
        ts = datetime.fromisoformat((top.get("publishedAt") or "").replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        ts = 0.0
    return {
        "id": f"yt_{c.get('id')}",
        "sub": f"youtube:{video_id}",
        "source_type": "youtube",
        "author": top.get("authorDisplayName") or "[anon]",
        "title": video_title[:200],  # video title for context; the comment is the body
        "selftext": (top.get("textOriginal") or "")[:2000],
        "url": f"https://youtu.be/{video_id}",
        "score": int(top.get("likeCount") or 0),
        "upvote_ratio": None,
        "num_comments": int(c.get("snippet", {}).get("totalReplyCount") or 0),
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": None,
        "permalink": f"https://youtu.be/{video_id}",
        "fetched_at": _now_iso(),
    }


def fetch_youtube_comments(video_id: str, video_title: str = "", limit: int = 100) -> list[dict]:
    key = _require_key()
    if not key:
        return [{"_error": "YOUTUBE_API_KEY not set"}]
    collected: list[dict] = []
    token: str | None = None
    while len(collected) < limit:
        params: dict[str, Any] = {
            "key": key, "videoId": video_id, "part": "snippet",
            "maxResults": min(100, limit - len(collected)), "order": "relevance",
        }
        if token:
            params["pageToken"] = token
        try:
            r = httpx.get(f"{_BASE}/commentThreads", params=params, timeout=20)
            r.raise_for_status()
        except httpx.HTTPError:
            break
        data = r.json() or {}
        items = data.get("items") or []
        if not items:
            break
        collected.extend(_comment_row(c, video_id, video_title) for c in items)
        token = data.get("nextPageToken")
        if not token:
            break
    return collected
