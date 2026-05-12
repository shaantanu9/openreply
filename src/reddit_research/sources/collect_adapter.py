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

    Backed by yt-dlp (free, no API key, no quota). Falls back to YouTube
    Data API v3 if yt-dlp is unavailable AND ``YOUTUBE_API_KEY`` is set;
    otherwise logs an empty result.
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
            # Use the full keyword fanout (LLM-expanded canonical terms). This
            # raises RSS recall for multi-word topics while keeping rows scoped
            # to the same canonical storage topic.
            kw_queries = kws if kws else [""]
            try:
                rows = fetch_rss(
                    url,
                    query=kw_queries,
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
            # Missing PH_TOKEN returns sentinel error rows ({"_error": ...}).
            # Filter those out so _persist doesn't KeyError on r["id"].
            rows = [r for r in rows if not (isinstance(r, dict) and r.get("_error"))]
            total += _persist(stopic, rows, source_tag=f"producthunt:{kw}")
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
        return total
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_crossref(topic_or_keywords: str | list[str], limit: int = 30) -> int:
    from .crossref import fetch_crossref
    return _run_simple_list(topic_or_keywords, "crossref", fetch_crossref, limit)


def run_semantic_scholar(topic_or_keywords: str | list[str], limit: int = 30) -> int:
    from .semantic_scholar import fetch_semantic_scholar
    return _run_simple_list(topic_or_keywords, "semantic_scholar", fetch_semantic_scholar, limit)


def run_bluesky(topic_or_keywords: str | list[str], limit: int = 30) -> int:
    from .bluesky import fetch_bluesky
    return _run_simple_list(topic_or_keywords, "bluesky", fetch_bluesky, limit)


def run_wikipedia(topic_or_keywords: str | list[str], limit: int = 5) -> int:
    """Wikipedia returns a structured summary (title, extract, etc.) — not
    a posts-shaped row. Reshape to `posts` schema so the canonical upsert
    path works: id = `wikipedia_<slug>`, title = page title, selftext =
    extract, url = canonical Wikipedia URL.
    """
    from datetime import datetime, timezone
    from .wikipedia import fetch_wikipedia_summary
    import re as _re
    def _as_list(kw: str, limit: int) -> list[dict]:
        r = fetch_wikipedia_summary(topic=kw)
        if not r or not r.get("title"):
            return []
        slug = _re.sub(r"[^a-z0-9]+", "_", (r.get("title") or "").lower()).strip("_") or "wiki"
        return [{
            "id":          f"wikipedia_{slug}",
            "sub":         "wikipedia",
            "source_type": "wikipedia",
            "author":      "Wikipedia",
            "title":       r.get("title") or kw,
            "selftext":    r.get("extract") or r.get("description") or "",
            "url":         r.get("url") or f"https://en.wikipedia.org/wiki/{slug}",
            "score":       int(r.get("pageviews") or 0),
            "upvote_ratio": 0.0,
            "num_comments": 0,
            "created_utc": 0,
            "is_self":     1,
            "over_18":     0,
            "flair":       "summary",
            "permalink":   r.get("url") or "",
            "fetched_at":  datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }]
    return _run_simple_list(topic_or_keywords, "wikipedia", _as_list, limit)


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


def _oc_persist(
    topic: str,
    rows: list[dict],
    *,
    site: str,
    keyword: str,
    map_row: Any,
) -> int:
    """Generic opencli persistence helper.

    `map_row(item)` returns a row in the unified posts schema (or None to
    skip). Source tag is `f"oc_{site}:{keyword}"` so attribution stays
    granular in topic_posts.source.
    """
    out: list[dict] = []
    for item in rows:
        try:
            mapped = map_row(item)
        except Exception:
            mapped = None
        if mapped:
            out.append(mapped)
    return _persist(topic, out, source_tag=f"oc_{site}:{keyword}")


def run_oc_bluesky(
    topic_or_keywords: str | list[str],
    limit: int = 25,
) -> int:
    """Bluesky author search via opencli (PUBLIC strategy, no browser).

    Returns USER profiles whose handle/name/bio matches the query —
    treated as authority-signal rows alongside post-based sources.
    """
    from . import opencli_bridge

    kws, stopic = _as_keywords(topic_or_keywords)
    if not kws or not opencli_bridge.is_available():
        return 0

    fid = log_fetch_start("oc_bluesky", {"keywords": kws, "limit": limit})
    total = 0
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%S")
    now_ts = time.time()
    try:
        for i, kw in enumerate(kws):
            data = opencli_bridge.run(
                "bluesky", "search", [kw, "--limit", str(limit)]
            )

            def _map(item: dict) -> dict | None:
                handle = (item.get("handle") or "").strip()
                if not handle:
                    return None
                name = (item.get("name") or "").strip() or handle
                desc = (item.get("description") or "").strip()
                followers = item.get("followers")
                try:
                    score = int(followers) if followers is not None else 0
                except (TypeError, ValueError):
                    score = 0
                url = f"https://bsky.app/profile/{handle}"
                return {
                    "id": f"oc_bluesky_{handle}",
                    "sub": "bluesky",
                    "source_type": "oc_bluesky",
                    "author": handle,
                    "title": name,
                    "selftext": desc,
                    "url": url,
                    "score": score,
                    "upvote_ratio": None,
                    "num_comments": 0,
                    "created_utc": now_ts,
                    "is_self": 1,
                    "over_18": 0,
                    "flair": None,
                    "permalink": url,
                    "fetched_at": now_iso,
                }

            total += _oc_persist(stopic, data, site="bluesky", keyword=kw, map_row=_map)
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
        return total
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_oc_substack(
    topic_or_keywords: str | list[str],
    limit: int = 25,
) -> int:
    """Substack post search via opencli — no native equivalent."""
    from . import opencli_bridge

    kws, stopic = _as_keywords(topic_or_keywords)
    if not kws or not opencli_bridge.is_available():
        return 0

    fid = log_fetch_start("oc_substack", {"keywords": kws, "limit": limit})
    total = 0
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%S")
    try:
        for i, kw in enumerate(kws):
            data = opencli_bridge.run("substack", "search", [kw, "--limit", str(limit)])

            def _map(item: dict, _kw: str = kw) -> dict | None:
                url = (item.get("url") or "").strip()
                title = (item.get("title") or "").strip()
                if not url or not title:
                    return None
                date_str = (item.get("date") or "").strip()
                try:
                    created = time.mktime(time.strptime(date_str, "%Y-%m-%d")) if date_str else time.time()
                except ValueError:
                    created = time.time()
                return {
                    "id": f"oc_substack_{abs(hash(url))}",
                    "sub": "substack",
                    "source_type": "oc_substack",
                    "author": (item.get("author") or "").strip(),
                    "title": title,
                    "selftext": (item.get("description") or "").strip(),
                    "url": url,
                    "score": 0,
                    "upvote_ratio": None,
                    "num_comments": 0,
                    "created_utc": created,
                    "is_self": 0,
                    "over_18": 0,
                    "flair": None,
                    "permalink": url,
                    "fetched_at": now_iso,
                }

            total += _oc_persist(stopic, data, site="substack", keyword=kw, map_row=_map)
            if i < len(kws) - 1:
                time.sleep(_KW_SLEEP)
        log_fetch_end(fid, rows=total)
        return total
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        return 0


def run_oc_producthunt_today(
    topic_or_keywords: str | list[str],
    limit: int = 30,
) -> int:
    """Product Hunt daily leaderboard via opencli.

    NOTE: ignores the topic — Product Hunt's `today` command surfaces the
    current day's launches site-wide. Tagged under the canonical topic so
    these rows feed broader competitive-landscape analysis.
    """
    from . import opencli_bridge

    _, stopic = _as_keywords(topic_or_keywords)
    if not stopic or not opencli_bridge.is_available():
        return 0

    fid = log_fetch_start("oc_producthunt_today", {"topic": stopic, "limit": limit})
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%S")
    now_ts = time.time()
    try:
        data = opencli_bridge.run(
            "producthunt", "today", ["--limit", str(limit)]
        )

        def _map(item: dict) -> dict | None:
            url = (item.get("url") or "").strip()
            name = (item.get("name") or "").strip()
            if not url or not name:
                return None
            return {
                "id": f"oc_phtoday_{abs(hash(url))}",
                "sub": "producthunt",
                "source_type": "oc_producthunt_today",
                "author": (item.get("author") or "").strip(),
                "title": name,
                "selftext": (item.get("tagline") or "").strip(),
                "url": url,
                "score": 0,
                "upvote_ratio": None,
                "num_comments": 0,
                "created_utc": now_ts,
                "is_self": 0,
                "over_18": 0,
                "flair": None,
                "permalink": url,
                "fetched_at": now_iso,
            }

        total = _oc_persist(stopic, data, site="producthunt", keyword="today", map_row=_map)
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
    # Discourse forums — caller must pass instance in kwargs (config-dependent).
    "discourse": run_discourse,
    # Paper sources added in 2026-04-21 paper-research toolkit
    "crossref":         run_crossref,
    "semantic_scholar": run_semantic_scholar,
    "wikipedia":        run_wikipedia,
    "bluesky":          run_bluesky,
    # opencli-backed adapters (require @jackwener/opencli built locally;
    # see src/reddit_research/sources/opencli_bridge.py for resolution).
    # Adapter ids prefixed `oc_` so they don't collide with native sources
    # of the same name (e.g. native `bluesky` searches POSTS via API,
    # `oc_bluesky` searches USERS via opencli).
    "oc_bluesky":            run_oc_bluesky,
    "oc_substack":           run_oc_substack,
    "oc_producthunt_today":  run_oc_producthunt_today,
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
    "rss_persuasion": _rss_category_runner("persuasion"),
    "rss_swipe": _rss_category_runner("swipe"),
}
