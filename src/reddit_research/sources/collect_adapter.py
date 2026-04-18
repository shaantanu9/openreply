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


def run_arxiv(topic: str, limit: int = 40) -> int:
    from .arxiv import fetch_arxiv

    fid = log_fetch_start("source:arxiv", {"topic": topic, "limit": limit})
    try:
        rows = fetch_arxiv(topic, limit=limit)
        n = _persist(topic, rows, source_tag="arxiv")
        log_fetch_end(fid, rows=n)
        return n
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_openalex(topic: str, limit: int = 40) -> int:
    from .openalex import fetch_openalex

    fid = log_fetch_start("source:openalex", {"topic": topic, "limit": limit})
    try:
        rows = fetch_openalex(topic, limit=limit)
        n = _persist(topic, rows, source_tag="openalex")
        log_fetch_end(fid, rows=n)
        return n
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_pubmed(topic: str, limit: int = 40) -> int:
    from .pubmed import fetch_pubmed

    fid = log_fetch_start("source:pubmed", {"topic": topic, "limit": limit})
    try:
        rows = fetch_pubmed(topic, limit=limit)
        n = _persist(topic, rows, source_tag="pubmed")
        log_fetch_end(fid, rows=n)
        return n
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_gnews(topic: str, limit: int = 40) -> int:
    from .gnews import fetch_gnews

    fid = log_fetch_start("source:gnews", {"topic": topic, "limit": limit})
    try:
        rows = fetch_gnews(topic, limit=limit)
        n = _persist(topic, rows, source_tag="gnews")
        log_fetch_end(fid, rows=n)
        return n
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_devto(topic: str, limit: int = 30) -> int:
    from .devto import fetch_devto

    fid = log_fetch_start("source:devto", {"topic": topic, "limit": limit})
    try:
        rows = fetch_devto(query=topic, limit=limit)
        n = _persist(topic, rows, source_tag="devto")
        log_fetch_end(fid, rows=n)
        return n
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_lemmy(topic: str, instance: str = "lemmy.world", limit: int = 30) -> int:
    from .lemmy import fetch_lemmy

    fid = log_fetch_start("source:lemmy", {"topic": topic, "instance": instance})
    try:
        rows = fetch_lemmy(topic, instance=instance, limit=limit)
        n = _persist(topic, rows, source_tag=f"lemmy:{instance}")
        log_fetch_end(fid, rows=n)
        return n
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_mastodon(topic: str, instance: str = "mastodon.social", limit: int = 30) -> int:
    from .mastodon import fetch_mastodon

    fid = log_fetch_start("source:mastodon", {"topic": topic, "instance": instance})
    try:
        rows = fetch_mastodon(topic, instance=instance, limit=limit)
        n = _persist(topic, rows, source_tag=f"mastodon:{instance}")
        log_fetch_end(fid, rows=n)
        return n
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_github_trending(topic: str, limit: int = 20) -> int:
    from .github_trending import search_github_repos

    fid = log_fetch_start("source:github_trending", {"topic": topic, "limit": limit})
    try:
        rows = search_github_repos(topic, limit=limit)
        n = _persist(topic, rows, source_tag="github")
        log_fetch_end(fid, rows=n)
        return n
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_github_issues(topic: str, limit: int = 30) -> int:
    from .github_issues import fetch_github_issues

    fid = log_fetch_start("source:github_issues", {"topic": topic, "limit": limit})
    try:
        rows = fetch_github_issues(topic, limit=limit)
        rows = [r for r in rows if "_error" not in r]
        n = _persist(topic, rows, source_tag="github_issue")
        log_fetch_end(fid, rows=n)
        return n
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_discourse(topic: str, instance: str, limit: int = 30) -> int:
    """Needs explicit `instance` (e.g. 'forum.obsidian.md'). Called directly, not via SOURCES."""
    from .discourse import fetch_discourse

    fid = log_fetch_start("source:discourse", {"topic": topic, "instance": instance})
    try:
        rows = fetch_discourse(topic, instance=instance, limit=limit)
        n = _persist(topic, rows, source_tag=f"discourse:{instance}")
        log_fetch_end(fid, rows=n)
        return n
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


# Dispatch map for the collect orchestrator
SOURCES: dict[str, Any] = {
    "hn": run_hn,
    "appstore": run_appstore,
    "playstore": run_playstore,
    "scholar": run_scholar,
    "stackoverflow": run_stackoverflow,
    "trends": run_trends,
    # New in Batch A/B/C/D
    "arxiv": run_arxiv,
    "openalex": run_openalex,
    "pubmed": run_pubmed,
    "gnews": run_gnews,
    "devto": run_devto,
    "lemmy": run_lemmy,
    "mastodon": run_mastodon,
    "github": run_github_trending,
    "github_issues": run_github_issues,
}
