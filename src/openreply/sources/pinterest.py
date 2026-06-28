"""Pinterest keyword search via ScrapeCreators. Saves (repin_count) are
the engagement signal. Ported from last30days lib/pinterest.py.
"""
from __future__ import annotations

from typing import Any

from . import _scrapecreators as sc


def _row(p: dict[str, Any]) -> dict[str, Any]:
    pid = p.get("id") or ""
    desc = (p.get("description") or "").strip()
    title = (p.get("title") or p.get("grid_title") or desc[:80]).strip()
    user = (p.get("pinner") or {}).get("username") or "[anon]"
    return {
        "id": f"pin_{pid}",
        "sub": "pinterest",
        "source_type": "pinterest",
        "author": user,
        "title": title[:200] or f"Pin {pid}",
        "selftext": desc,
        "url": f"https://www.pinterest.com/pin/{pid}/" if pid else "",
        "score": int(p.get("repin_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(p.get("comment_count") or 0),
        "created_utc": 0.0,
        "is_self": 1,
        "over_18": 0,
        "flair": f"saves={int(p.get('repin_count') or 0)}",
        "permalink": f"https://www.pinterest.com/pin/{pid}/" if pid else "",
        "fetched_at": sc.now_iso(),
    }


def fetch_pinterest(query: str, limit: int = 20) -> list[dict]:
    if sc.api_key() is None:
        return [sc.error_row("Pinterest")]
    data = sc.get("/v1/pinterest/search", params={"query": query})
    if data is None:
        return []
    items = data.get("results") or data.get("pins") or []
    return [_row(p) for p in items[:limit] if p.get("id")]
