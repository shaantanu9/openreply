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


# reviews_per_app trimmed 100 → 50 (2026-06-07): the google-play scraper
# paginates reviews slowly (~1.4 s/review observed), so 5 apps × 100 reviews ran
# ~11 min and pinned an external-pool worker far past the pool budget, starving
# faster sources. 50/app still yields a solid review corpus per app while
# keeping the adapter inside a sane time envelope. Tunable upward for a deep run.
def run_playstore(topic_or_keywords: str | list[str], apps: int = 5, reviews_per_app: int = 50) -> int:
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


# Stack Exchange NETWORK — many high-signal Q&A communities via the same free,
# no-auth API as Stack Overflow. Each site is its own pain/feature-request
# corpus (IT, sysadmin, software design, UX, product recommendations, etc.).
# One source toggle → ~8 communities. Per-site failures are isolated.
_STACKEXCHANGE_SITES = (
    "superuser", "serverfault", "softwareengineering", "ux",
    "webmasters", "softwarerecs", "devops", "security",
)


def run_stackexchange(
    topic_or_keywords: str | list[str], limit: int = 15, sites: tuple[str, ...] | None = None
) -> int:
    from .stackoverflow import fetch_stackoverflow

    site_list = sites or _STACKEXCHANGE_SITES
    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start(
        "source:stackexchange", {"keywords": kws, "sites": list(site_list), "limit": limit}
    )
    total = 0
    try:
        for kw in kws:
            for site in site_list:
                try:
                    rows = fetch_stackoverflow(query=kw, site=site, sort="relevance", limit=limit)
                    for r in rows:
                        r["source_type"] = "stackexchange"  # group all SE sites under one source
                    total += _persist(stopic, rows, source_tag=f"stackexchange:{site}:{kw}")
                except Exception:
                    continue  # one site down never kills the rest
                time.sleep(0.4)  # be gentle on the shared SE quota
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
    whisper_fallback: bool = False,
    whisper_cap: int = 3,
) -> int:
    """Search YouTube + pull top-voted comments per video.

    Backed by yt-dlp (free, no API key, no quota). Falls back to YouTube
    Data API v3 if yt-dlp is unavailable AND ``YOUTUBE_API_KEY`` is set;
    otherwise logs an empty result.

    ``whisper_fallback`` — when a found video has no caption track, transcribe
    its audio locally with faster-whisper. Slow, so it is capped at
    ``whisper_cap`` videos per collect (across all keywords) and is only
    enabled for aggressive / rerun collects (wired in research/collect.py).
    """
    from .youtube import fetch_youtube_comments, fetch_youtube_video_meta, search_youtube_videos

    kws, stopic = _as_keywords(topic_or_keywords)
    fid = log_fetch_start(
        "source:youtube",
        {"keywords": kws, "videos": videos, "comments_per_video": comments_per_video,
         "whisper_fallback": whisper_fallback, "whisper_cap": whisper_cap},
    )
    total = 0
    whisper_used = 0
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
                title = v.get("title") or ""
                # Pull comments first (existing behaviour), then ask yt-dlp
                # for the description + transcript so a persona ingest over
                # this topic sees what the speaker actually said, not just
                # what commenters reacted to. meta is best-effort — videos
                # with subs disabled return [] and we still keep comments.
                comment_rows = fetch_youtube_comments(
                    vid, video_title=title, limit=comments_per_video,
                )
                comment_rows = [r for r in comment_rows if "_error" not in r]
                # Whisper fallback (caption-less videos only) is budget-capped
                # across the whole collect — pass allow only while budget left.
                allow_whisper = whisper_fallback and whisper_used < whisper_cap
                meta_rows = fetch_youtube_video_meta(
                    vid, video_title=title, allow_whisper=allow_whisper,
                )
                if allow_whisper and any("_wx" in (r.get("id") or "") for r in meta_rows):
                    whisper_used += 1
                rows = comment_rows + meta_rows
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
    url_names: dict[str, str] | None = None,
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
    # Tag extra URLs under the "user" category, with the feed's display name as
    # publication so rows are identifiable (sub=rss:user, source=rss:user:<name>).
    _names = url_names or {}
    for u in urls or []:
        if u:
            feeds.append(("user", _names.get(u) or "custom", u))
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


def run_rss_user(topic_or_keywords: str | list[str]) -> int:
    """Sweep the user's own saved RSS feeds (Settings → Custom RSS feeds).

    Reads enabled rows from the `user_feeds` table and routes them through
    run_rss as extra URLs — topic-keyword filtered like every other RSS source.
    Uses the empty "user" sentinel category so ONLY the user's feeds are fetched
    (no curated bundle). Returns 0 gracefully when the user has no feeds.
    """
    from ..core.db import list_user_feeds

    feeds = [f for f in list_user_feeds(enabled_only=True) if f.get("url")]
    if not feeds:
        return 0
    urls = [f["url"] for f in feeds]
    names = {f["url"]: (f.get("name") or f["url"]) for f in feeds}
    return run_rss(topic_or_keywords, categories=["user"], urls=urls, url_names=names)


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


def run_europepmc(topic_or_keywords: str | list[str], limit: int = 30) -> int:
    from .europepmc import fetch_europepmc
    return _run_simple_list(topic_or_keywords, "europepmc", fetch_europepmc, limit)


def run_dblp(topic_or_keywords: str | list[str], limit: int = 30) -> int:
    from .dblp import fetch_dblp
    return _run_simple_list(topic_or_keywords, "dblp", fetch_dblp, limit)


def run_steam(topic_or_keywords: str | list[str], limit: int = 30) -> int:
    from .steam import fetch_steam
    return _run_simple_list(topic_or_keywords, "steam", fetch_steam, limit)


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


# ── miroclaw-derived external sources ────────────────────────────────
# Web/news map cleanly to posts rows; macro/numeric sources render each
# datum as a text-summary post. All pure-httpx, never raise. Key-gated
# ones (tavily/fred/acled) return 0 rows cleanly when the env var is unset.
def run_gdelt(topic_or_keywords: str | list[str], limit: int = 50) -> int:
    from .gdelt import fetch_gdelt
    return _run_simple_list(topic_or_keywords, "gdelt", fetch_gdelt, limit)


def run_duckduckgo(topic_or_keywords: str | list[str], limit: int = 25) -> int:
    from .duckduckgo import fetch_duckduckgo
    return _run_simple_list(topic_or_keywords, "duckduckgo", fetch_duckduckgo, limit)


def run_tavily(topic_or_keywords: str | list[str], limit: int = 15) -> int:
    from .tavily import fetch_tavily
    return _run_simple_list(topic_or_keywords, "tavily", fetch_tavily, limit)


def run_worldbank(topic_or_keywords: str | list[str], limit: int = 7) -> int:
    from .worldbank import fetch_worldbank
    return _run_simple_list(topic_or_keywords, "worldbank", fetch_worldbank, limit)


def run_fred(topic_or_keywords: str | list[str], limit: int = 6) -> int:
    from .fred import fetch_fred
    return _run_simple_list(topic_or_keywords, "fred", fetch_fred, limit)


def run_bis(topic_or_keywords: str | list[str], limit: int = 6) -> int:
    from .bis import fetch_bis
    return _run_simple_list(topic_or_keywords, "bis", fetch_bis, limit)


def run_yfinance(topic_or_keywords: str | list[str], limit: int = 6) -> int:
    from .yfinance_src import fetch_yfinance
    return _run_simple_list(topic_or_keywords, "yfinance", fetch_yfinance, limit)


def run_openmeteo(topic_or_keywords: str | list[str], limit: int = 5) -> int:
    from .openmeteo import fetch_openmeteo
    return _run_simple_list(topic_or_keywords, "openmeteo", fetch_openmeteo, limit)


def run_acled(topic_or_keywords: str | list[str], limit: int = 30) -> int:
    from .acled import fetch_acled
    return _run_simple_list(topic_or_keywords, "acled", fetch_acled, limit)


# ── last30days Phase-1: social + prediction-market sources ───────────────────
def run_polymarket(topic_or_keywords: str | list[str], limit: int = 20) -> int:
    from .polymarket import fetch_polymarket
    return _run_simple_list(topic_or_keywords, "polymarket", fetch_polymarket, limit)


def run_truthsocial(topic_or_keywords: str | list[str], limit: int = 30) -> int:
    from .truthsocial import fetch_truthsocial
    return _run_simple_list(topic_or_keywords, "truthsocial", fetch_truthsocial, limit)


def run_digg(topic_or_keywords: str | list[str], limit: int = 20) -> int:
    from .digg import fetch_digg
    return _run_simple_list(topic_or_keywords, "digg", fetch_digg, limit)


def run_tiktok(topic_or_keywords: str | list[str], limit: int = 20) -> int:
    from .tiktok import fetch_tiktok
    return _run_simple_list(topic_or_keywords, "tiktok", fetch_tiktok, limit)


def run_instagram(topic_or_keywords: str | list[str], limit: int = 20) -> int:
    from .instagram import fetch_instagram
    return _run_simple_list(topic_or_keywords, "instagram", fetch_instagram, limit)


def run_threads(topic_or_keywords: str | list[str], limit: int = 20) -> int:
    from .threads import fetch_threads
    return _run_simple_list(topic_or_keywords, "threads", fetch_threads, limit)


def run_pinterest(topic_or_keywords: str | list[str], limit: int = 20) -> int:
    from .pinterest import fetch_pinterest
    return _run_simple_list(topic_or_keywords, "pinterest", fetch_pinterest, limit)


def run_x(topic_or_keywords: str | list[str], limit: int = 20) -> int:
    from .x_twitter import fetch_x
    return _run_simple_list(topic_or_keywords, "x", fetch_x, limit)


# ── Agent Reach ports (2026-06-16) ───────────────────────────────────────────
# Keyword-searchable platforms use the shared _run_simple_list helper. The
# URL-readers (web_reader, linkedin, xiaoyuzhou) accept a URL as the "keyword"
# and no-op (return 0) on plain keywords — they're primarily MCP/CLI tools.

def run_v2ex(topic_or_keywords: str | list[str], limit: int = 50) -> int:
    from .v2ex import fetch_v2ex
    return _run_simple_list(topic_or_keywords, "v2ex", fetch_v2ex, limit)


def run_bilibili(topic_or_keywords: str | list[str], limit: int = 50) -> int:
    from .bilibili import fetch_bilibili
    return _run_simple_list(topic_or_keywords, "bilibili", fetch_bilibili, limit)


def run_xueqiu(topic_or_keywords: str | list[str], limit: int = 50) -> int:
    from .xueqiu import fetch_xueqiu
    return _run_simple_list(topic_or_keywords, "xueqiu", fetch_xueqiu, limit)


def run_exa(topic_or_keywords: str | list[str], limit: int = 30) -> int:
    from .exa_search import fetch_exa_search
    return _run_simple_list(topic_or_keywords, "exa", fetch_exa_search, limit)


def run_xiaohongshu(topic_or_keywords: str | list[str], limit: int = 30) -> int:
    from .xiaohongshu import fetch_xiaohongshu
    return _run_simple_list(topic_or_keywords, "xiaohongshu", fetch_xiaohongshu, limit)


def run_reddit_free(topic_or_keywords: str | list[str], limit: int = 50) -> int:
    from .reddit_free import fetch_reddit_free
    return _run_simple_list(topic_or_keywords, "reddit_free", fetch_reddit_free, limit)


def run_web_reader(topic_or_keywords: str | list[str], limit: int = 1) -> int:
    from .web_reader import fetch_web_reader
    return _run_simple_list(topic_or_keywords, "web", fetch_web_reader, limit)


def run_linkedin(topic_or_keywords: str | list[str], limit: int = 1) -> int:
    from .linkedin import fetch_linkedin
    return _run_simple_list(topic_or_keywords, "linkedin", fetch_linkedin, limit)


def run_xiaoyuzhou(topic_or_keywords: str | list[str], limit: int = 1) -> int:
    from .xiaoyuzhou import fetch_xiaoyuzhou
    return _run_simple_list(topic_or_keywords, "xiaoyuzhou", fetch_xiaoyuzhou, limit)


# Dispatch map for the collect orchestrator
SOURCES: dict[str, Any] = {
    "hn": run_hn,
    "appstore": run_appstore,
    "playstore": run_playstore,
    "scholar": run_scholar,
    "stackoverflow": run_stackoverflow,
    "stackexchange": run_stackexchange,
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
    "steam":         run_steam,
    # RSS bundle — one entry per category so the UI picker can offer
    # granular opt-in. All delegate to run_rss under the hood.
    # Discourse forums — caller must pass instance in kwargs (config-dependent).
    "discourse": run_discourse,
    # Paper sources added in 2026-04-21 paper-research toolkit
    "crossref":         run_crossref,
    "semantic_scholar": run_semantic_scholar,
    "europepmc":        run_europepmc,
    "dblp":             run_dblp,
    "wikipedia":        run_wikipedia,
    "bluesky":          run_bluesky,
    # opencli-backed adapters (require @jackwener/opencli built locally;
    # see src/openreply/sources/opencli_bridge.py for resolution).
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
    "rss_listings": _rss_category_runner("listings"),
    "rss_user": run_rss_user,  # user-added custom feeds (Settings → Custom RSS)
    "rss_engineering": _rss_category_runner("engineering"),
    "rss_ml": _rss_category_runner("ml"),
    "rss_design": _rss_category_runner("design"),
    "rss_psychology": _rss_category_runner("psychology"),
    "rss_neuroscience": _rss_category_runner("neuroscience"),
    "rss_science": _rss_category_runner("science"),
    "rss_marketing": _rss_category_runner("marketing"),
    "rss_persuasion": _rss_category_runner("persuasion"),
    "rss_swipe": _rss_category_runner("swipe"),
    # miroclaw-derived external sources (pure-httpx, posts-row output).
    "gdelt":       run_gdelt,
    "duckduckgo":  run_duckduckgo,
    "tavily":      run_tavily,        # needs TAVILY_API_KEY
    "worldbank":   run_worldbank,
    "fred":        run_fred,          # needs FRED_API_KEY
    "bis":         run_bis,
    "yfinance":    run_yfinance,
    "openmeteo":   run_openmeteo,
    "acled":       run_acled,         # needs ACLED_EMAIL + ACLED_PASSWORD
    # last30days Phase-1 social + prediction-market sources.
    "polymarket":  run_polymarket,    # free, no key
    "digg":        run_digg,          # free, needs digg-pp-cli on PATH
    "truthsocial": run_truthsocial,   # TRUTHSOCIAL_TOKEN
    "tiktok":      run_tiktok,        # SCRAPECREATORS_API_KEY
    "instagram":   run_instagram,     # SCRAPECREATORS_API_KEY
    "threads":     run_threads,       # SCRAPECREATORS_API_KEY
    "pinterest":   run_pinterest,     # SCRAPECREATORS_API_KEY
    "x":           run_x,             # AUTH_TOKEN/CT0 | XAI_API_KEY | XQUIK_API_KEY
    # Agent Reach ports (2026-06-16). Chinese platforms + free overlaps.
    "v2ex":        run_v2ex,          # free, public API
    "bilibili":    run_bilibili,      # free (optional BILIBILI_PROXY)
    "xueqiu":      run_xueqiu,        # free (cookie-warm; optional stored token)
    "exa":         run_exa,           # EXA_API_KEY (free tier)
    "xiaohongshu": run_xiaohongshu,   # needs connected cookie (Reach Connections)
    "reddit_free": run_reddit_free,   # cookie/proxy JSON, RSS fallback
    "web":         run_web_reader,    # URL reader (Jina) — pass a URL as topic
    "linkedin":    run_linkedin,      # public LinkedIn URL reader (Jina)
    "xiaoyuzhou":  run_xiaoyuzhou,    # podcast episode metadata — pass a URL
}
