"""Instagram Reels keyword search via ScrapeCreators. Score = like_count,
views (play_count) in flair. Ported from last30days lib/instagram.py.
"""
from __future__ import annotations

from typing import Any

from . import _scrapecreators as sc


def _row(it: dict[str, Any]) -> dict[str, Any]:
    user = (it.get("user") or {}).get("username") or "[anon]"
    cap = ((it.get("caption") or {}).get("text") or "").strip()
    code = it.get("code") or it.get("shortcode") or ""
    return {
        "id": f"ig_{it.get('id') or code}",
        "sub": "instagram",
        "source_type": "instagram",
        "author": user,
        "title": cap[:200] or f"Reel by {user}",
        "selftext": cap,
        "url": f"https://www.instagram.com/reel/{code}/" if code else "",
        "score": int(it.get("like_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(it.get("comment_count") or 0),
        "created_utc": float(it.get("taken_at") or 0),
        "is_self": 1,
        "over_18": 0,
        "flair": f"views={int(it.get('play_count') or 0)}",
        "permalink": f"https://www.instagram.com/reel/{code}/" if code else "",
        "fetched_at": sc.now_iso(),
    }


def fetch_instagram(query: str, limit: int = 20) -> list[dict]:
    if sc.api_key() is None:
        return [sc.error_row("Instagram")]
    data = sc.get("/v1/instagram/search", params={"query": query})
    if data is None:
        return []
    items = data.get("items") or data.get("results") or []
    return [_row(it) for it in items[:limit] if (it.get("id") or it.get("code"))]
