"""Google News via free RSS feeds. No key, no rate limit beyond Google's.

https://news.google.com/rss/search?q=<query>
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _require_feedparser():
    try:
        import feedparser  # type: ignore
    except ImportError as e:
        raise RuntimeError("Install sources extra: pip install -e '.[sources]'") from e
    return feedparser


def fetch_gnews(query: str, limit: int = 50, lang: str = "en", country: str = "US") -> list[dict]:
    feedparser = _require_feedparser()
    url = "https://news.google.com/rss/search"
    params = {"q": query, "hl": f"{lang}-{country}", "gl": country, "ceid": f"{country}:{lang}"}
    try:
        r = httpx.get(url, params=params, timeout=20)
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    feed = feedparser.parse(r.text)
    rows: list[dict] = []
    for entry in (feed.entries or [])[:limit]:
        ts = 0.0
        if hasattr(entry, "published_parsed") and entry.published_parsed:
            import calendar
            ts = float(calendar.timegm(entry.published_parsed))
        rid = entry.get("id") or entry.get("link") or ""
        rows.append(
            {
                "id": f"gnews_{hash(rid) & 0xffffffff:x}",
                "sub": "gnews",
                "source_type": "gnews",
                "author": entry.get("source", {}).get("title", "") if isinstance(entry.get("source"), dict) else str(entry.get("source") or ""),
                "title": (entry.get("title") or "")[:300],
                "selftext": (entry.get("summary") or "")[:2000],
                "url": entry.get("link") or "",
                "score": 0,
                "upvote_ratio": None,
                "num_comments": 0,
                "created_utc": ts,
                "is_self": 0,
                "over_18": 0,
                "flair": None,
                "permalink": entry.get("link"),
                "fetched_at": _now_iso(),
            }
        )
    return rows
