"""Google News via free RSS feeds. No key, no rate limit beyond Google's.

https://news.google.com/rss/search?q=<query>
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

import httpx

from ._http import DEFAULT_HEADERS


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _stable_id(ident: str) -> str:
    return hashlib.sha256(ident.encode("utf-8")).hexdigest()[:16]


def _require_feedparser():
    try:
        import feedparser  # type: ignore
    except ImportError as e:
        raise RuntimeError("Install sources extra: pip install -e '.[sources]'") from e
    return feedparser


def fetch_gnews(query: str, limit: int = 50, lang: str = "en", country: str = "US") -> list[dict]:
    feedparser = _require_feedparser()
    url = "https://news.google.com/rss/search"
    # Google News RSS expects hl=<lang> (e.g. "en"), not "en-US".
    params = {"q": query, "hl": lang, "gl": country, "ceid": f"{country}:{lang}"}
    try:
        # Google News RSS 302-redirects to a regional/consent host; without
        # follow_redirects httpx returns an empty 302 body → 0 entries.
        r = httpx.get(url, params=params, headers=DEFAULT_HEADERS, timeout=20,
                      follow_redirects=True)
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
        # Publisher name (e.g. "BBC", "Reuters", "TechCrunch"). Falls back
        # to "google-news" so the row still has a non-empty bucket label.
        # Previously this field stored the literal string "gnews", which
        # the UI rendered as "r/gnews" (Reddit-style) and linked to a
        # 404 reddit URL. The `source_type` field is the canonical
        # source identifier; `sub` is the per-row sub-bucket.
        src = entry.get("source")
        if isinstance(src, dict):
            publisher = (src.get("title") or "").strip()
        else:
            publisher = str(src or "").strip()
        publisher_slug = (publisher.lower().replace(" ", "-") if publisher else "google-news")[:60]
        rows.append(
            {
                "id": f"gnews_{_stable_id(rid)}",
                "sub": publisher_slug,
                "source_type": "gnews",
                "author": publisher,
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
                # IMPORTANT: leave permalink empty for non-Reddit sources.
                # The frontend prepends https://www.reddit.com to permalink
                # when it's set, so a non-empty permalink here would
                # produce a broken reddit.com link. The article URL lives
                # in the `url` field above.
                "permalink": None,
                "fetched_at": _now_iso(),
            }
        )
    return rows
