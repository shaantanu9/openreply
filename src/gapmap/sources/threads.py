"""Threads keyword search via ScrapeCreators. Score = like_count.
Ported from last30days lib/threads.py.
"""
from __future__ import annotations

from typing import Any

from . import _scrapecreators as sc


def _row(p: dict[str, Any]) -> dict[str, Any]:
    user = p.get("username") or "[anon]"
    text = (p.get("text") or (p.get("caption") or {}).get("text") or "").strip()
    code = p.get("code") or ""
    return {
        "id": f"th_{p.get('id') or code}",
        "sub": "threads",
        "source_type": "threads",
        "author": user,
        "title": text[:200] or f"Thread by {user}",
        "selftext": text,
        "url": f"https://www.threads.net/@{user}/post/{code}" if code else "",
        "score": int(p.get("like_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(p.get("reply_count") or 0),
        "created_utc": float(p.get("taken_at") or 0),
        "is_self": 1,
        "over_18": 0,
        "flair": "",
        "permalink": f"https://www.threads.net/@{user}/post/{code}" if code else "",
        "fetched_at": sc.now_iso(),
    }


def fetch_threads(query: str, limit: int = 20) -> list[dict]:
    if sc.api_key() is None:
        return [sc.error_row("Threads")]
    data = sc.get("/v1/threads/search", params={"query": query})
    if data is None:
        return []
    items = data.get("posts") or data.get("results") or []
    return [_row(p) for p in items[:limit] if (p.get("id") or p.get("code"))]
