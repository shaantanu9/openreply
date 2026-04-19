"""Collect orchestrator — builds a topic-scoped corpus in SQLite.

Steps:
  1. Discover relevant subs (or accept user-provided list)
  2. Fetch top posts (month + year) from each sub
  3. Run each query template category across those subs (or all of Reddit)
  4. Tag every collected post with the research topic so we can query it
     back later regardless of which sub it came from

Works in both auth and public mode; just uses the existing fetch modules.
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any

from ..core.db import get_db
from ..core.pullpush_client import CUTOFF_UTC
from ..fetch.historical import fetch_historical
from ..fetch.posts import fetch_posts
from ..fetch.search import search_reddit
from .discover import discover_subs
from .prompts import render_queries

# Politeness delay between HTTP calls — Reddit's public endpoint is tight.
_SLEEP = 2.0

# Max concurrent workers for the "extra sources" stage. Each worker hits a
# different provider (HN / arXiv / GitHub / …), so this is parallelism across
# independent hosts — not hammering any single one. Reddit stages stay
# sequential because Reddit does rate-limit aggressively.
_PARALLEL_SOURCES = 6


@dataclass
class CollectResult:
    topic: str
    subs: list[str] = field(default_factory=list)
    posts_fetched: int = 0
    by_source: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


def _ensure_topics_table() -> None:
    db = get_db()
    if "topic_posts" in db.table_names():
        return
    db["topic_posts"].create(
        {"topic": str, "post_id": str, "source": str, "added_at": str},
        pk=("topic", "post_id"),
    )
    db["topic_posts"].create_index(["topic"])


def _tag_posts(topic: str, post_ids: list[str], source: str) -> int:
    if not post_ids:
        return 0
    _ensure_topics_table()
    db = get_db()
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = [
        {"topic": topic, "post_id": pid, "source": source, "added_at": now}
        for pid in post_ids
        if pid
    ]
    # Ignore-on-conflict so rerunning a topic doesn't error
    db["topic_posts"].insert_all(rows, pk=("topic", "post_id"), ignore=True)
    return len(rows)


def collect(
    topic: str,
    subs: list[str] | None = None,
    limit_per_sub: int = 50,
    limit_per_query: int = 25,
    query_categories: list[str] | None = None,
    sub_scope_search: bool = True,
    include_historical: bool = False,
    historical_days: int = 730,
    historical_limit_per_sub: int = 500,
    aggressive: bool = False,
    sources: list[str] | None = None,  # extra sources: hn/appstore/playstore/scholar/stackoverflow/trends
    skip_reddit: bool = False,  # skip Reddit fetch stages (2+3); useful for external-only reruns
    progress=None,  # optional callable(message: str) for CLI progress
) -> CollectResult:
    """Run the full collection for a topic.

    Args:
      subs: override discovery with a user-provided list of sub names.
      limit_per_sub: top-of-month + top-of-year each fetch this many posts.
      limit_per_query: search fetch this many per query template.
      query_categories: subset of ['pain','features','complaints','diy'].
      sub_scope_search: if True, restrict searches to the discovered subs.
      include_historical: also pull pre-May-2025 posts via pullpush.
      historical_days: days to look back from the May-2025 pullpush cutoff.
      historical_limit_per_sub: max historical posts per sub.
      aggressive: preset that maxes limits + enables comments + historical.
    """
    # Aggressive preset — overrides conservative defaults
    if aggressive:
        limit_per_sub = max(limit_per_sub, 100)
        limit_per_query = max(limit_per_query, 50)
        include_historical = True
        historical_days = max(historical_days, 1095)  # 3 years
        historical_limit_per_sub = max(historical_limit_per_sub, 1000)
        query_categories = query_categories or ["pain", "features", "complaints", "diy"]
        if not sources:
            # Full free-and-reliable source sweep — matches the "10-source
            # pipeline" the Science + onboarding screens promise. Each source
            # runs in its own thread (see _PARALLEL_SOURCES below) and errors
            # are captured per-source, so one flaky provider doesn't kill the
            # rest. Sources that need explicit config (lemmy / mastodon need
            # instance URLs; github_issues + scholar hit rate limits without
            # tokens) are left opt-in via `--sources` instead of aggressive.
            sources = [
                "hn",            # Hacker News
                "appstore",      # App Store reviews
                "playstore",     # Play Store reviews
                "arxiv",         # arXiv preprints
                "openalex",      # OpenAlex academic catalogue
                "pubmed",        # PubMed (biomed literature)
                "gnews",         # Google News
                "devto",         # Dev.to posts
                "stackoverflow", # Stack Overflow Q&A
                "github",        # GitHub trending repos
                "trends",        # Google Trends series (returns series, not posts)
            ]
    elif not sources:
        # Non-aggressive default: still pull from a baseline of FAST FREE
        # external sources so "quick" mode is never reddit-only. Users
        # expect to see HN / arXiv / GitHub alongside Reddit even on a
        # short collect. Historical pullpush + heavy stores (app/play/gnews
        # /pubmed/openalex/trends) stay gated behind aggressive — those add
        # minutes and aren't free-fast.
        sources = [
            "hn",            # Hacker News — fast, free, 1 call
            "arxiv",         # arXiv — fast, free, 1 call
            "devto",         # Dev.to — fast, free, 1 call
            "stackoverflow", # Stack Overflow — fast, free, 1 call
            "github",        # GitHub trending — fast, free, 1 call
        ]
    # `result.topic` ends up being set to the canonical after canonicalization
    # below. Populate with original here; we update after _canonicalize_topic
    # resolves (handles the no-LLM-configured passthrough case cleanly).
    result = CollectResult(topic=topic)

    # Canonicalize ONCE at the top so every downstream query (reddit sub
    # discovery, reddit search, HN, arXiv, OpenAlex, PubMed, Scholar, etc.)
    # hits the corrected domain. "calari tracking app" → "calorie tracking app"
    # before anything fans out. We keep the user's original `topic` as the
    # storage key so the UI still labels it with what they typed; only search
    # queries use the canonical string.
    try:
        from .discover import _canonicalize_topic
        _canon = _canonicalize_topic(topic)
        search_topic = (
            _canon.get("canonical") or topic
            if (_canon.get("confidence") in ("high", "low"))
            else topic
        )
    except Exception:
        search_topic = topic
    if search_topic != topic:
        result.errors.append(
            f"info: search using canonical '{search_topic}' (user typed '{topic}')"
        )
        # Canonical becomes the storage key too — otherwise Reddit data lands
        # under the typo while arXiv/HN data lands under the corrected form,
        # splitting the user's corpus across two topics.
        result.topic = search_topic

    # Query expansion — use the LLM-scored keywords from the canonicalize
    # call to fan out per-source queries. Recall 3-5× vs the single canonical
    # string. `high`-only by default; `aggressive` adds `medium` too. Cap via
    # GAPMAP_MAX_KEYWORDS.
    # Default lowered to 1 on 2026-04-20 — 5 keywords × 11 sources × 1 s
    # politeness ≈ 55 s added to every aggressive collect, which felt like
    # a hang to users. Opt in to higher recall via the env var once you've
    # seen the baseline latency.
    import os as _os
    try:
        _max_kw = int(_os.getenv("GAPMAP_MAX_KEYWORDS", "1") or "1")
    except ValueError:
        _max_kw = 1
    _min_rel = "medium" if aggressive else "high"
    _rel_rank = {"high": 3, "medium": 2, "low": 1}
    _min_rank = _rel_rank.get(_min_rel, 3)
    search_keywords = [
        k["keyword"]
        for k in (_canon.get("search_keywords") if isinstance(_canon, dict) else []) or []
        if _rel_rank.get(k.get("relevance", "low"), 0) >= _min_rank
    ][:_max_kw]
    # Always guarantee at least the canonical topic.
    if not search_keywords:
        search_keywords = [search_topic]

    # Thread-safe log — prevents interleaved stdout writes when the parallel
    # stage has multiple workers emitting progress at once. Also guards
    # result.by_source / result.errors / result.posts_fetched mutations.
    _log_lock = threading.Lock()

    def _log(msg: str) -> None:
        if progress:
            with _log_lock:
                progress(msg)

    # 1. Discover if not provided (skip if skip_reddit and no subs given)
    if skip_reddit and not subs:
        # No need to discover subs if we're not fetching from Reddit at all.
        result.subs = []
        _log("skip_reddit=true → skipping Reddit discovery + fetch")
    elif subs is None:
        _log(f"discovering subs for '{search_topic}'…")
        found = discover_subs(search_topic, limit=8)
        # New shape: {"subs": [...], "confirmation": {...}}. Tolerate the old
        # list form for backward-compat with mocked tests.
        found_subs = found.get("subs", found) if isinstance(found, dict) else found
        subs = [s["name"] for s in found_subs if s.get("name")]
        _log(f"  → {subs}")
        time.sleep(_SLEEP)
        result.subs = subs
    else:
        result.subs = subs

    # 3b setup. We kick the external-sources pool off IN PARALLEL with the
    # Reddit stages below. Each external adapter hits a distinct host (HN,
    # arXiv, App Store, …), so there's no rate-limit contention with Reddit.
    # SQLite WAL (enabled in core.db) tolerates concurrent writers. Running
    # them concurrently turns a ~5-minute sequential collect into ~2-3 min
    # and — importantly — gives the user visible progress on ALL sources
    # from the start, instead of staring at reddit-only logs for minutes.
    ext_pool: ThreadPoolExecutor | None = None
    ext_futures: dict = {}
    ext_valid: list[str] = []
    if sources:
        from ..sources.collect_adapter import SOURCES

        for src in sources:
            if src in SOURCES:
                ext_valid.append(src)
            else:
                _log(f"  ! unknown source: {src}")
                result.errors.append(f"unknown source: {src}")

        def _run_source(src: str) -> tuple[str, int | dict | None, Exception | None, float]:
            """Run one source fetch; return (src, value, error, elapsed_s)."""
            t0 = time.monotonic()
            _log(f"[{src}] starting…")
            try:
                fn = SOURCES[src]
                # Adapters now accept either a single string (legacy) OR a
                # list of keywords (fanout). TypeError fallback keeps compat
                # with any adapter that hasn't been updated yet.
                try:
                    out = fn(search_keywords)
                except TypeError:
                    out = fn(search_keywords[0] if search_keywords else search_topic)
                return (src, out, None, time.monotonic() - t0)
            except Exception as e:
                return (src, None, e, time.monotonic() - t0)

        if ext_valid:
            workers = min(_PARALLEL_SOURCES, len(ext_valid))
            _log(f"[parallel] fetching {len(ext_valid)} sources across {workers} workers (concurrently with Reddit)…")
            ext_pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="gap-src")
            ext_futures = {ext_pool.submit(_run_source, s): s for s in ext_valid}

    # Wrap Reddit stages in try/finally so the external pool is always drained
    # and shut down, even if a Reddit stage raises unexpectedly. Without this,
    # an aborted collect could leak up to 6 daemon threads per abort.
    try:
        if not skip_reddit:
            # 2. Top-of-month / top-of-year per sub
            for sub in subs:
                for tf in ("month", "year"):
                    try:
                        _log(f"fetch r/{sub} top({tf}) limit={limit_per_sub}")
                        rows = fetch_posts(sub=sub, sort="top", limit=limit_per_sub, time_filter=tf)
                        tagged = _tag_posts(search_topic, [r["id"] for r in rows], source=f"top:{sub}:{tf}")
                        with _log_lock:
                            result.posts_fetched += tagged
                            result.by_source[f"top:{sub}:{tf}"] = tagged
                    except Exception as e:
                        msg = f"top {sub}/{tf}: {e}"
                        _log(f"  ! {msg}")
                        with _log_lock:
                            result.errors.append(msg)
                    time.sleep(_SLEEP)

            # 3. Parameterized searches — fan out across all expanded keywords.
            # render_queries(kw) gives us 4 category buckets; merge + dedup across
            # keywords so we don't hit the same exact query twice.
            merged: dict[str, list[str]] = {}
            for _kw in search_keywords:
                for _cat, _qs in render_queries(_kw, categories=query_categories).items():
                    merged.setdefault(_cat, []).extend(_qs)
            queries = {c: list(dict.fromkeys(qs)) for c, qs in merged.items()}
            if len(search_keywords) > 1:
                _log(f"query expansion: {len(search_keywords)} keywords → "
                     f"{sum(len(v) for v in queries.values())} unique queries")
            for category, qs in queries.items():
                for q in qs:
                    # If sub_scope_search: search each sub individually (slower but higher signal)
                    targets: list[str | None] = subs if sub_scope_search else [None]
                    for target in targets:
                        try:
                            _log(f"search {category!r}: {q!r}" + (f" in r/{target}" if target else ""))
                            rows = search_reddit(
                                query=q,
                                sub=target,
                                sort="relevance",
                                time_filter="year",
                                limit=limit_per_query,
                            )
                            tagged = _tag_posts(
                                search_topic,
                                [r["id"] for r in rows],
                                source=f"search:{category}:{target or 'all'}:{q}",
                            )
                            with _log_lock:
                                result.posts_fetched += tagged
                                key = f"search:{category}"
                                result.by_source[key] = result.by_source.get(key, 0) + tagged
                        except Exception as e:
                            msg = f"search {category} {q!r}: {e}"
                            _log(f"  ! {msg}")
                            with _log_lock:
                                result.errors.append(msg)
                        time.sleep(_SLEEP)

        # 4. Historical — pullpush (pre-May-2025). Runs on main thread after
        # Reddit stages finish; pullpush is a different host from Reddit's
        # public API but keeping it sequential avoids contention with a
        # still-running top/search burst. External-source pool keeps
        # streaming in parallel.
        if include_historical:
            for sub in subs:
                try:
                    _log(f"historical r/{sub} last {historical_days}d pre-cutoff, limit={historical_limit_per_sub}")
                    hrows = fetch_historical(
                        sub=sub,
                        kind="submission",
                        days=historical_days,
                        limit=historical_limit_per_sub,
                    )
                    tagged = _tag_posts(search_topic, [r["id"] for r in hrows], source=f"pullpush:{sub}")
                    with _log_lock:
                        result.posts_fetched += tagged
                        result.by_source[f"pullpush:{sub}"] = tagged
                except Exception as e:
                    msg = f"pullpush {sub}: {e}"
                    _log(f"  ! {msg}")
                    with _log_lock:
                        result.errors.append(msg)
                time.sleep(_SLEEP)
    finally:
        # 3b (drain). Join the external-source pool — some workers may still
        # be in flight while Reddit finished early, or the pool may already
        # be done if Reddit took a long time. Collect per-source results so
        # the final log line reflects every provider. Always executed, even
        # if a Reddit stage raised — keeps the pool from leaking threads.
        if ext_pool is not None and ext_futures:
            done_count = 0
            for fut in as_completed(ext_futures):
                src, out, err, elapsed = fut.result()
                done_count += 1
                prefix = f"[{done_count}/{len(ext_valid)}] [{src}]"
                if err is not None:
                    msg = f"{prefix} ✗ {err} ({elapsed:.1f}s)"
                    _log(msg)
                    with _log_lock:
                        result.errors.append(f"source:{src}: {err}")
                elif src == "trends":
                    # trends returns dict of keyword → trend series, not a post count
                    _log(f"{prefix} ✓ trends series collected ({elapsed:.1f}s)")
                    with _log_lock:
                        result.by_source[f"source:{src}"] = out
                else:
                    n = int(out or 0)
                    _log(f"{prefix} ✓ {n} posts ({elapsed:.1f}s)")
                    with _log_lock:
                        result.posts_fetched += n
                        result.by_source[f"source:{src}"] = n
            ext_pool.shutdown(wait=True)

    _log(f"done. {result.posts_fetched} posts tagged for '{search_topic}'.")
    return result


def corpus_temporal_split(
    topic: str,
    cutoff_utc: int | None = None,
    limit_per_bucket: int = 100,
    min_score: int = 1,
) -> dict:
    """Return the topic corpus split into pre/post May-2025 buckets.

    Use this to ask Claude (or another LLM) to compare pain patterns across
    the two eras — chronic vs emerging vs fading signals.
    """
    cutoff = cutoff_utc or CUTOFF_UTC
    db = get_db()

    def _pull(where_clause: str, params: list) -> list[dict]:
        # Academic sources (arxiv/pubmed/scholar/openalex) + ingested files
        # don't have Reddit-style engagement scores; many return score=0.
        # Exempt them from the min_score floor — otherwise the LLM never sees
        # the very papers the user collected to ground their analysis.
        sql = f"""
            SELECT p.id, p.sub, p.author, p.title,
                   substr(p.selftext, 1, 500) AS selftext,
                   p.score, p.num_comments, p.created_utc,
                   coalesce(p.source_type, 'reddit') AS source_type
            FROM posts p JOIN topic_posts tp ON tp.post_id = p.id
            WHERE tp.topic = ?
              AND (p.score >= ? OR coalesce(p.source_type,'reddit') != 'reddit')
              {where_clause}
            ORDER BY (p.num_comments * 2 + p.score) DESC
            LIMIT ?
        """
        return list(db.query(sql, [topic, min_score, *params, limit_per_bucket]))

    return {
        "topic": topic,
        "cutoff_utc": cutoff,
        "pre_2025": _pull("AND p.created_utc < ?", [cutoff]),
        "post_2025": _pull("AND p.created_utc >= ?", [cutoff]),
    }


def corpus_for(topic: str, limit: int = 200, min_score: int = 1) -> list[dict[str, Any]]:
    """Pull the collected corpus for a topic, newest-engaged first.

    min_score only gates Reddit posts. Academic sources (arxiv / pubmed /
    openalex / scholar) and ingested files (pdfs / local docs) are always
    included regardless of score, because their fetchers don't populate a
    meaningful engagement number — a zero-citation arxiv paper is still
    signal, and silently filtering it was a bug.
    """
    db = get_db()
    return list(
        db.query(
            """
            SELECT p.id, p.sub, p.author, p.title, p.selftext,
                   p.score, p.num_comments, p.created_utc, p.permalink,
                   p.url, coalesce(p.source_type, 'reddit') AS source_type
            FROM posts p
            JOIN topic_posts tp ON tp.post_id = p.id
            WHERE tp.topic = ?
              AND (p.score >= ? OR coalesce(p.source_type,'reddit') != 'reddit')
            ORDER BY (p.num_comments * 2 + p.score) DESC
            LIMIT ?
            """,
            [topic, min_score, limit],
        )
    )
