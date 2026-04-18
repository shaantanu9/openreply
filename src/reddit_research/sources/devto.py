"""DEV.to articles via their free public API. https://developers.forem.com/api"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

_BASE = "https://dev.to/api"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(a: dict[str, Any]) -> dict[str, Any]:
    try:
        ts = datetime.fromisoformat((a.get("published_at") or "").replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        ts = 0.0
    return {
        "id": f"devto_{a.get('id')}",
        "sub": "devto",
        "source_type": "devto",
        "author": (a.get("user") or {}).get("username") or "[anon]",
        "title": (a.get("title") or "")[:300],
        "selftext": (a.get("description") or "")[:2000],
        "url": a.get("url") or "",
        "score": int(a.get("positive_reactions_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(a.get("comments_count") or 0),
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": ",".join(a.get("tag_list") or [])[:100],
        "permalink": a.get("url"),
        "fetched_at": _now_iso(),
    }


def fetch_devto(query: str | None = None, tag: str | None = None, limit: int = 30) -> list[dict]:
    """Search DEV.to articles. Use `query` for text, `tag` for tag-based.

    DEV.to's public API lacks full-text search; we pull a wider pool (up to
    1000 articles, paginated) and do client-side keyword matching against
    title/description/tags when `query` is given.
    """
    if tag:
        try:
            r = httpx.get(f"{_BASE}/articles", params={"tag": tag, "per_page": min(100, limit)}, timeout=15)
            r.raise_for_status()
            arts = r.json() or []
        except httpx.HTTPError:
            arts = []
        rows = [_row(a) for a in arts]
        if query:
            q = query.lower()
            rows = [r for r in rows if q in (r["title"] or "").lower() or q in (r["selftext"] or "").lower()]
        return rows[:limit]

    # No tag → scan several pages of top articles + client-side text filter
    all_rows: list[dict] = []
    for page in range(1, 4):  # up to 300 articles
        try:
            r = httpx.get(f"{_BASE}/articles", params={"page": page, "per_page": 100, "top": 7}, timeout=15)
            r.raise_for_status()
            arts = r.json() or []
        except httpx.HTTPError:
            break
        if not arts:
            break
        all_rows.extend(_row(a) for a in arts)
    if query:
        q = query.lower()
        all_rows = [r for r in all_rows if q in (r["title"] or "").lower() or q in (r["selftext"] or "").lower() or q in (r["flair"] or "").lower()]
    return all_rows[:limit]
