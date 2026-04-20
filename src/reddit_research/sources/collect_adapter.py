"""Per-source collection helpers — called from research.collect when a
--sources flag includes each name. Each returns (rows_added_count, source_tag).

Common contract: upsert into `posts` table, tag via topic_posts, log fetch.

Every adapter's first positional arg accepts EITHER a single topic string
(legacy) OR a list of expanded search keywords (new). When given a list,
the adapter loops the keywords with a politeness sleep between them so no
single provider gets hammered. Storage `topic` uses the FIRST keyword
(the canonical) so all expanded queries land under one topic.
"""
from __future__ import annotations

import time
from typing import Any

from ..core.db import log_fetch_end, log_fetch_start, upsert_posts

# Politeness delay between keywords within a single adapter. Each adapter
# hits one host; we don't want to stream N queries in microseconds.
_KW_SLEEP = 1.0


def _as_keywords(topic_or_keywords: str | list[str]) -> tuple[list[str], str]:
    """Normalize the adapter's first arg to (keywords_list, storage_topic).

    storage_topic = first keyword in the list, so all expanded queries end
    up tagged under one canonical topic row.
    """
    if isinstance(topic_or_keywords, str):
        k = topic_or_keywords.strip()
        return ([k], k) if k else ([], "")
    kws = [str(k).strip() for k in (topic_or_keywords or []) if str(k).strip()]
    return (kws, kws[0] if kws else "")


def _persist(topic: str, rows: list[dict], source_tag: str) -> int:
    from ..research.collect import _tag_posts

    if not rows:
        return 0
    upsert_posts(rows)
    return _tag_posts(topic, [r["id"] for r in rows], source=source_tag)


# ── Adapters ────────────────────────────────────────────────────────────


def run_hn(topic_or_keywords: str | list[str], limit_per_tag: int = 30) -> int:
    from .hackernews import fetch_hn

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start("source:hn", {"keywords": kws, "limit": limit_per_tag})
    total = 0
    try:
        for i, kw in enumerate(kws):
            for tags in ("story", "ask_hn,show_hn"):
                rows = fetch_hn(query=kw, tags=tags, sort="relevance", limit=limit_per_tag)
                total += _persist(stopic, rows, source_tag=f"hn:{tags}:{kw}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
    return total


def run_appstore(topic_or_keywords: str | list[str], apps: int = 5, pages_per_app: int = 3) -> int:
    from .appstore import fetch_appstore_reviews, search_appstore_apps

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start(
        "source:appstore",
        {"keywords": kws, "apps": apps, "pages_per_app": pages_per_app},
    )
    total = 0
    seen_track_ids: set = set()
    try:
        for i, kw in enumerate(kws):
            discovered = search_appstore_apps(kw, limit=apps)
            for a in discovered:
                tid = a.get("track_id")
                if not tid or tid in seen_track_ids:
                    continue
                seen_track_ids.add(tid)
                revs = fetch_appstore_reviews(
                    tid, app_name=a.get("name") or "",
                    pages=pages_per_app, max_reviews=pages_per_app * 50,
                )
                total += _persist(stopic, revs, source_tag=f"appstore:{a.get('name')}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
    return total


def run_playstore(topic_or_keywords: str | list[str], apps: int = 5, reviews_per_app: int = 100) -> int:
    from .playstore import fetch_playstore_reviews, search_playstore_apps

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start(
        "source:playstore",
        {"keywords": kws, "apps": apps, "reviews_per_app": reviews_per_app},
    )
    total = 0
    seen_app_ids: set = set()
    try:
        for i, kw in enumerate(kws):
            discovered = search_playstore_apps(kw, limit=apps)
            for a in discovered:
                aid = a.get("app_id")
                if not aid or aid in seen_app_ids:
                    continue
                seen_app_ids.add(aid)
                revs = fetch_playstore_reviews(aid, count=reviews_per_app)
                total += _persist(stopic, revs, source_tag=f"playstore:{a.get('name')}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
    return total


def run_scholar(topic_or_keywords: str | list[str], limit: int = 40, year_from: int | None = None) -> int:
    from .scholar import fetch_scholar

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start("source:scholar", {"keywords": kws, "limit": limit})
    total = 0
    try:
        for i, kw in enumerate(kws):
            rows = fetch_scholar(query=kw, limit=limit, year_from=year_from)
            total += _persist(stopic, rows, source_tag=f"scholar:{kw}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
    return total


def run_stackoverflow(topic_or_keywords: str | list[str], limit: int = 30, tag: str | None = None) -> int:
    from .stackoverflow import fetch_stackoverflow

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start("source:stackoverflow", {"keywords": kws, "limit": limit, "tag": tag})
    total = 0
    try:
        for i, kw in enumerate(kws):
            rows = fetch_stackoverflow(query=kw, tag=tag, limit=limit)
            total += _persist(stopic, rows, source_tag=f"stackoverflow:{kw}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
    return total


def run_trends(
    topic_or_keywords: str | list[str],
    keywords: list[str] | None = None,
    timeframe: str = "today 5-y",
) -> dict:
    """Trends works best with a few related keywords as a comparison set.
    If we're given a keyword list, use it directly; otherwise fall back to
    single-string.
    """
    from .trends import fetch_trends

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start("source:trends", {"keywords": kws})
    try:
        # If caller didn't override `keywords`, pass the expanded list.
        kw_for_trends = keywords or (kws[1:] if len(kws) > 1 else None)
        r = fetch_trends(topic=stopic, keywords=kw_for_trends, timeframe=timeframe)
        total = sum(len(v) for v in (r.get("series") or {}).values())
        log_fetch_end(fid, rows=total)
        return r
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return {"error": str(e)}


def _run_simple_list(
    topic_or_keywords: str | list[str],
    source_tag: str,
    fetcher,
    limit: int,
) -> int:
    """Shared pattern: fetcher(kw, limit=…) → rows → _persist."""
    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start(f"source:{source_tag}", {"keywords": kws, "limit": limit})
    total = 0
    try:
        for i, kw in enumerate(kws):
            rows = fetcher(kw, limit=limit)
            # Some fetchers return sentinel error dicts; drop them.
            rows = [r for r in rows if not (isinstance(r, dict) and r.get("_error"))]
            total += _persist(stopic, rows, source_tag=f"{source_tag}:{kw}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
        return total
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_arxiv(topic_or_keywords: str | list[str], limit: int = 40) -> int:
    from .arxiv import fetch_arxiv
    return _run_simple_list(topic_or_keywords, "arxiv", fetch_arxiv, limit)


def run_openalex(topic_or_keywords: str | list[str], limit: int = 40) -> int:
    from .openalex import fetch_openalex
    return _run_simple_list(topic_or_keywords, "openalex", fetch_openalex, limit)


def run_pubmed(topic_or_keywords: str | list[str], limit: int = 40) -> int:
    from .pubmed import fetch_pubmed
    return _run_simple_list(topic_or_keywords, "pubmed", fetch_pubmed, limit)


def run_gnews(topic_or_keywords: str | list[str], limit: int = 40) -> int:
    from .gnews import fetch_gnews
    return _run_simple_list(topic_or_keywords, "gnews", fetch_gnews, limit)


def run_devto(topic_or_keywords: str | list[str], limit: int = 30) -> int:
    from .devto import fetch_devto

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start("source:devto", {"keywords": kws, "limit": limit})
    total = 0
    try:
        for i, kw in enumerate(kws):
            rows = fetch_devto(query=kw, limit=limit)
            total += _persist(stopic, rows, source_tag=f"devto:{kw}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
        return total
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_lemmy(topic_or_keywords: str | list[str], instance: str = "lemmy.world", limit: int = 30) -> int:
    from .lemmy import fetch_lemmy

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start("source:lemmy", {"keywords": kws, "instance": instance})
    total = 0
    try:
        for i, kw in enumerate(kws):
            rows = fetch_lemmy(kw, instance=instance, limit=limit)
            total += _persist(stopic, rows, source_tag=f"lemmy:{instance}:{kw}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
        return total
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_mastodon(topic_or_keywords: str | list[str], instance: str = "mastodon.social", limit: int = 30) -> int:
    from .mastodon import fetch_mastodon

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start("source:mastodon", {"keywords": kws, "instance": instance})
    total = 0
    try:
        for i, kw in enumerate(kws):
            rows = fetch_mastodon(kw, instance=instance, limit=limit)
            total += _persist(stopic, rows, source_tag=f"mastodon:{instance}:{kw}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
        return total
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_github_trending(topic_or_keywords: str | list[str], limit: int = 20) -> int:
    from .github_trending import search_github_repos

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start("source:github_trending", {"keywords": kws, "limit": limit})
    total = 0
    try:
        for i, kw in enumerate(kws):
            rows = search_github_repos(kw, limit=limit)
            total += _persist(stopic, rows, source_tag=f"github:{kw}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
        return total
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_github_issues(topic_or_keywords: str | list[str], limit: int = 30) -> int:
    from .github_issues import fetch_github_issues

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start("source:github_issues", {"keywords": kws, "limit": limit})
    total = 0
    try:
        for i, kw in enumerate(kws):
            rows = fetch_github_issues(kw, limit=limit)
            rows = [r for r in rows if "_error" not in r]
            total += _persist(stopic, rows, source_tag=f"github_issue:{kw}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
        return total
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_discourse(topic_or_keywords: str | list[str], instance: str, limit: int = 30) -> int:
    """Needs explicit `instance`. Called directly, not via SOURCES."""
    from .discourse import fetch_discourse

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start("source:discourse", {"keywords": kws, "instance": instance})
    total = 0
    try:
        for i, kw in enumerate(kws):
            rows = fetch_discourse(kw, instance=instance, limit=limit)
            total += _persist(stopic, rows, source_tag=f"discourse:{instance}:{kw}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
        return total
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_youtube(
    topic_or_keywords: str | list[str],
    videos: int = 10,
    comments_per_video: int = 100,
) -> int:
    """Search YouTube + pull top-voted comments per video.

    Gated behind YOUTUBE_API_KEY. Silently skips if no key is set (logs an
    empty result).
    """
    from .youtube import fetch_youtube_comments, search_youtube_videos

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start(
        "source:youtube",
        {"keywords": kws, "videos": videos, "comments_per_video": comments_per_video},
    )
    total = 0
    seen_video_ids: set = set()
    try:
        for i, kw in enumerate(kws):
            vids = search_youtube_videos(kw, limit=videos)
            if vids and isinstance(vids[0], dict) and vids[0].get("_error"):
                log_fetch_end(fid, rows=0, error=vids[0]["_error"])
                return 0
            for v in vids:
                vid = v.get("video_id")
                if not vid or vid in seen_video_ids:
                    continue
                seen_video_ids.add(vid)
                rows = fetch_youtube_comments(
                    vid, video_title=v.get("title") or "", limit=comments_per_video,
                )
                rows = [r for r in rows if "_error" not in r]
                if not rows:
                    continue
                total += _persist(stopic, rows, source_tag=f"youtube:{vid}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
        return total
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_rss(
    topic_or_keywords: str | list[str],
    categories: list[str] | None = None,
    urls: list[str] | None = None,
    limit_per_feed: int = 20,
) -> int:
    """Fetch curated RSS feeds for one or more category buckets.

    `categories` — list of keys from rss_catalog.CATALOG. None → default set.
    `urls` — optional extra feed URLs appended to the category list.

    Entries are filtered by topic keyword match (case-insensitive substring
    in title/summary) so a `langchain` topic doesn't drown in unrelated
    TechCrunch stories. Each feed is a distinct host so a short inter-feed
    sleep is enough politeness.
    """
    from .rss import fetch_rss
    from .rss_catalog import feeds_for_categories

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start(
        "source:rss",
        {"keywords": kws, "categories": categories, "extra_urls": urls or []},
    )
    total = 0
    feeds: list[tuple[str, str, str]] = feeds_for_categories(categories)
    # Tag extra URLs as category="custom".
    for u in urls or []:
        if u:
            feeds.append(("custom", "custom", u))
    try:
        for i, (cat, publication, url) in enumerate(feeds):
            # Use the first keyword for filtering — matches storage_topic
            # semantics used by every other adapter in this file.
            kw = kws[0] if kws else ""
            try:
                rows = fetch_rss(
                    url,
                    query=kw,
                    publication=publication,
                    category=cat,
                    limit=limit_per_feed,
                )
            except Exception:
                # One flaky feed shouldn't kill the rest.
                rows = []
            total += _persist(stopic, rows, source_tag=f"rss:{cat}:{publication}")
            if i < len(feeds) - 1:
                time.sleep(0.3)  # per-feed politeness, different hosts
        log_fetch_end(fid, rows=total)
        return total
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_trustpilot(
    topic_or_keywords: str | list[str],
    pages_per_brand: int = 3,
    limit_per_brand: int = 60,
) -> int:
    """Trustpilot consumer reviews — highest-value non-app-store customer
    feedback source. Searches for each keyword as a brand name; pages
    through reviews for each resolved brand.

    Legal caveat baked into sources/trustpilot.py: ToS grey area. Polite
    UA, rate-limited, degrades to 0 on any failure. For production use,
    contact Trustpilot for API access.
    """
    from .trustpilot import fetch_trustpilot

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start(
        "source:trustpilot",
        {"keywords": kws, "pages_per_brand": pages_per_brand},
    )
    total = 0
    try:
        for i, kw in enumerate(kws):
            rows = fetch_trustpilot(kw, pages=pages_per_brand, limit=limit_per_brand)
            total += _persist(stopic, rows, source_tag=f"trustpilot:{kw}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
        return total
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_producthunt(topic_or_keywords: str | list[str], limit: int = 30) -> int:
    """Product Hunt launch posts + comments. Needs PH_TOKEN env (free
    developer tier). Degrades to 0 if not configured.

    Signal value: launch-window consumer + indie-hacker reactions to new
    products in the user's category. Complements App Store (mature) with
    fresher early-adopter feedback.
    """
    from .producthunt import fetch_producthunt

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start("source:producthunt", {"keywords": kws, "limit": limit})
    total = 0
    try:
        for i, kw in enumerate(kws):
            rows = fetch_producthunt(query=kw, limit=limit)
            total += _persist(stopic, rows, source_tag=f"producthunt:{kw}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
        return total
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_alternativeto(topic_or_keywords: str | list[str], limit: int = 30) -> int:
    """AlternativeTo.net — "what's the alternative to X" signal, useful
    for competitor discovery in the Insight Engine.

    Known flaky: Cloudflare bot-protects the API. Adapter degrades to
    empty on 403 without crashing the rest of the collect.
    """
    from .alternativeto import fetch_alternativeto

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start("source:alternativeto", {"keywords": kws, "limit": limit})
    total = 0
    try:
        for i, kw in enumerate(kws):
            rows = fetch_alternativeto(kw, limit=limit)
            total += _persist(stopic, rows, source_tag=f"alternativeto:{kw}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
        return total
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def _rss_category_runner(cat: str):
    """Bind `run_rss` to a specific category so it can be registered
    as its own SOURCES entry (rss_startup, rss_ml, …). The wizard CSV
    source flag stays simple — one id per category — while the underlying
    fetch logic is shared.
    """
    def _run(topic_or_keywords, *args, **kwargs):
        return run_rss(topic_or_keywords, categories=[cat], **kwargs)
    _run.__name__ = f"run_rss_{cat}"
    return _run


# Dispatch map for the collect orchestrator
SOURCES: dict[str, Any] = {
    "hn": run_hn,
    "appstore": run_appstore,
    "playstore": run_playstore,
    "scholar": run_scholar,
    "stackoverflow": run_stackoverflow,
    "trends": run_trends,
    "arxiv": run_arxiv,
    "openalex": run_openalex,
    "pubmed": run_pubmed,
    "gnews": run_gnews,
    "devto": run_devto,
    "lemmy": run_lemmy,
    "mastodon": run_mastodon,
    "github": run_github_trending,
    "github_issues": run_github_issues,
    "youtube": run_youtube,
    # Phase-4-era customer-feedback additions. Each is an independent
    # host so parallelizes cleanly with the existing fan-out. Trustpilot
    # + Product Hunt close the consumer-feedback gap; AlternativeTo gives
    # competitor-discovery signal for the Insight Engine's competitor map.
    "trustpilot":    run_trustpilot,
    "producthunt":   run_producthunt,
    "alternativeto": run_alternativeto,
    # RSS bundle — one entry per category so the UI picker can offer
    # granular opt-in. All delegate to run_rss under the hood.
    "rss": run_rss,  # default bundle (see rss_catalog.DEFAULT_CATEGORIES)
    "rss_learning": _rss_category_runner("learning"),
    "rss_startup": _rss_category_runner("startup"),
    "rss_tech_news": _rss_category_runner("tech_news"),
    "rss_products": _rss_category_runner("products"),
    "rss_engineering": _rss_category_runner("engineering"),
    "rss_ml": _rss_category_runner("ml"),
    "rss_design": _rss_category_runner("design"),
    "rss_psychology": _rss_category_runner("psychology"),
    "rss_neuroscience": _rss_category_runner("neuroscience"),
    "rss_science": _rss_category_runner("science"),
    "rss_marketing": _rss_category_runner("marketing"),
}
