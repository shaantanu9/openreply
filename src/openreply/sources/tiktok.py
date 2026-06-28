"""TikTok keyword search via ScrapeCreators. Score = likes (digg_count),
views in flair. Ported from last30days lib/tiktok.py.
"""
from __future__ import annotations

from typing import Any

from . import _scrapecreators as sc


def _row(info: dict[str, Any]) -> dict[str, Any]:
    stats = info.get("statistics") or {}
    author = (info.get("author") or {}).get("unique_id") or "[anon]"
    desc = (info.get("desc") or "").strip()
    aid = info.get("aweme_id") or ""
    return {
        "id": f"tt_{aid}",
        "sub": "tiktok",
        "source_type": "tiktok",
        "author": author,
        "title": desc[:200] or f"TikTok by {author}",
        "selftext": desc,
        "url": info.get("share_url") or f"https://www.tiktok.com/@{author}/video/{aid}",
        "score": int(stats.get("digg_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(stats.get("comment_count") or 0),
        "created_utc": float(info.get("create_time") or 0),
        "is_self": 1,
        "over_18": 0,
        "flair": f"views={int(stats.get('play_count') or 0)}",
        "permalink": info.get("share_url") or "",
        "fetched_at": sc.now_iso(),
    }


def fetch_tiktok(query: str, limit: int = 20) -> list[dict]:
    if sc.api_key() is None:
        return [sc.error_row("TikTok")]
    data = sc.get("/v1/tiktok/search", params={"query": query})
    if data is None:
        return []
    items = data.get("search_item_list") or []
    out = []
    for it in items[:limit]:
        info = it.get("aweme_info") or it
        if info.get("aweme_id"):
            out.append(_row(info))
    return out
