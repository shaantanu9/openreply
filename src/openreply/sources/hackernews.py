"""Hacker News search via Algolia API. Free, no key needed.

https://hn.algolia.com/api
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Literal

import httpx

_BASE = "https://hn.algolia.com/api/v1"

Sort = Literal["relevance", "date"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(d: dict[str, Any]) -> dict[str, Any]:
    oid = d.get("objectID") or d.get("id")
    title = d.get("title") or (d.get("story_title") or "")[:200]
    body = d.get("story_text") or d.get("comment_text") or ""
    # Algolia hits come back with created_at ISO + created_at_i (unix)
    created = d.get("created_at_i") or 0
    return {
        "id": f"hn_{oid}",
        "sub": "hn",
        "source_type": "hn",
        "author": d.get("author") or "[deleted]",
        "title": title,
        "selftext": body,
        "url": d.get("url") or f"https://news.ycombinator.com/item?id={oid}",
        "score": int(d.get("points") or 0),
        "upvote_ratio": None,
        "num_comments": int(d.get("num_comments") or 0),
        "created_utc": float(created),
        "is_self": int(not bool(d.get("url"))),
        "over_18": 0,
        "flair": (d.get("_tags") or [None])[0] or "",  # 'story' / 'comment' / 'ask_hn' ...
        "permalink": f"https://news.ycombinator.com/item?id={oid}",
        "fetched_at": _now_iso(),
    }


def fetch_hn(
    query: str,
    tags: str = "story",  # 'story' | 'comment' | 'show_hn' | 'ask_hn' | 'poll'
    sort: Sort = "relevance",
    limit: int = 50,
    page_size: int = 50,
) -> list[dict]:
    """Search HN via Algolia. Use tags='story' for posts, 'comment' for replies.

    Multiple tags: comma-separated (e.g., 'story,ask_hn').
    """
    endpoint = "/search" if sort == "relevance" else "/search_by_date"
    collected: list[dict] = []
    page = 0
    hits_per_page = min(100, page_size)
    while len(collected) < limit:
        params: dict[str, Any] = {
            "query": query,
            "tags": tags,
            "hitsPerPage": min(hits_per_page, limit - len(collected)),
            "page": page,
        }
        try:
            r = httpx.get(f"{_BASE}{endpoint}", params=params, timeout=20)
            r.raise_for_status()
        except httpx.HTTPError:
            break
        data = r.json()
        hits = data.get("hits") or []
        if not hits:
            break
        for h in hits:
            collected.append(_row(h))
        if page >= (data.get("nbPages") or 0) - 1:
            break
        page += 1
        time.sleep(0.3)
    return collected[:limit]
