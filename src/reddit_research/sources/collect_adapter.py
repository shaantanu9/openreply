"""Per-source collection helpers — called from research.collect when a
--sources flag includes each name. Each returns (rows_added_count, source_tag).

Common contract: upsert into `posts` table, tag via topic_posts, log fetch.
"""
from __future__ import annotations

from typing import Any

from ..core.db import log_fetch_end, log_fetch_start, upsert_posts


def _persist(topic: str, rows: list[dict], source_tag: str) -> int:
    from ..research.collect import _tag_posts

    if not rows:
        return 0
    upsert_posts(rows)
    return _tag_posts(topic, [r["id"] for r in rows], source=source_tag)


def run_hn(topic: str, limit_per_tag: int = 30) -> int:
    from .hackernews import fetch_hn

    fid = log_fetch_start("source:hn", {"topic": topic, "limit": limit_per_tag})
    total = 0
    try:
        for tags in ("story", "ask_hn,show_hn"):
            rows = fetch_hn(query=topic, tags=tags, sort="relevance", limit=limit_per_tag)
            total += _persist(topic, rows, source_tag=f"hn:{tags}")
        log_fetch_end(fid, rows=total)
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
    return total


def run_appstore(topic: str, apps: int = 5, pages_per_app: int = 3) -> int:
    from .appstore import fetch_appstore_reviews, search_appstore_apps

    fid = log_fetch_start(
        "source:appstore", {"topic": topic, "apps": apps, "pages_per_app": pages_per_app}
    )
    total = 0
    try:
        discovered = search_appstore_apps(topic, limit=apps)
        for a in discovered:
            if not a.get("track_id"):
                continue
            revs = fetch_appstore_reviews(
                a["track_id"], app_name=a.get("name") or "",
                pages=pages_per_app, max_reviews=pages_per_app * 50,
            )
            total += _persist(topic, revs, source_tag=f"appstore:{a.get('name')}")
        log_fetch_end(fid, rows=total)
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
    return total


def run_playstore(topic: str, apps: int = 5, reviews_per_app: int = 100) -> int:
    from .playstore import fetch_playstore_reviews, search_playstore_apps

    fid = log_fetch_start(
        "source:playstore", {"topic": topic, "apps": apps, "reviews_per_app": reviews_per_app}
    )
    total = 0
    try:
        discovered = search_playstore_apps(topic, limit=apps)
        for a in discovered:
            if not a.get("app_id"):
                continue
            revs = fetch_playstore_reviews(a["app_id"], count=reviews_per_app)
            total += _persist(topic, revs, source_tag=f"playstore:{a.get('name')}")
        log_fetch_end(fid, rows=total)
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
    return total


def run_scholar(topic: str, limit: int = 40, year_from: int | None = None) -> int:
    from .scholar import fetch_scholar

    fid = log_fetch_start("source:scholar", {"topic": topic, "limit": limit})
    total = 0
    try:
        rows = fetch_scholar(query=topic, limit=limit, year_from=year_from)
        total = _persist(topic, rows, source_tag="scholar")
        log_fetch_end(fid, rows=total)
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
    return total


def run_stackoverflow(topic: str, limit: int = 30, tag: str | None = None) -> int:
    from .stackoverflow import fetch_stackoverflow

    fid = log_fetch_start("source:stackoverflow", {"topic": topic, "limit": limit, "tag": tag})
    total = 0
    try:
        rows = fetch_stackoverflow(query=topic, tag=tag, limit=limit)
        total = _persist(topic, rows, source_tag="stackoverflow")
        log_fetch_end(fid, rows=total)
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
    return total


def run_trends(topic: str, keywords: list[str] | None = None, timeframe: str = "today 5-y") -> dict:
    from .trends import fetch_trends

    fid = log_fetch_start("source:trends", {"topic": topic, "keywords": keywords})
    try:
        r = fetch_trends(topic=topic, keywords=keywords, timeframe=timeframe)
        total = sum(len(v) for v in (r.get("series") or {}).values())
        log_fetch_end(fid, rows=total)
        return r
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return {"error": str(e)}


# Dispatch map for the collect orchestrator
SOURCES: dict[str, Any] = {
    "hn": run_hn,
    "appstore": run_appstore,
    "playstore": run_playstore,
    "scholar": run_scholar,
    "stackoverflow": run_stackoverflow,
    "trends": run_trends,
}
