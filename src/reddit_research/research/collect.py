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
            sources = ["hn", "appstore", "playstore"]  # highest-signal free sources
    result = CollectResult(topic=topic)

    # Thread-safe log — prevents interleaved stdout writes when the parallel
    # stage has multiple workers emitting progress at once. Also guards
    # result.by_source / result.errors / result.posts_fetched mutations.
    _log_lock = threading.Lock()

    def _log(msg: str) -> None:
        if progress:
            with _log_lock:
                progress(msg)

    # 1. Discover if not provided
    if subs is None:
        _log(f"discovering subs for '{topic}'…")
        found = discover_subs(topic, limit=8)
        subs = [s["name"] for s in found if s.get("name")]
        _log(f"  → {subs}")
        time.sleep(_SLEEP)
    result.subs = subs

    # 2. Top-of-month / top-of-year per sub
    for sub in subs:
        for tf in ("month", "year"):
            try:
                _log(f"fetch r/{sub} top({tf}) limit={limit_per_sub}")
                rows = fetch_posts(sub=sub, sort="top", limit=limit_per_sub, time_filter=tf)
                tagged = _tag_posts(topic, [r["id"] for r in rows], source=f"top:{sub}:{tf}")
                result.posts_fetched += tagged
                result.by_source[f"top:{sub}:{tf}"] = tagged
            except Exception as e:
                msg = f"top {sub}/{tf}: {e}"
                _log(f"  ! {msg}")
                result.errors.append(msg)
            time.sleep(_SLEEP)

    # 3. Parameterized searches
    queries = render_queries(topic, categories=query_categories)
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
                        topic,
                        [r["id"] for r in rows],
                        source=f"search:{category}:{target or 'all'}:{q}",
                    )
                    result.posts_fetched += tagged
                    key = f"search:{category}"
                    result.by_source[key] = result.by_source.get(key, 0) + tagged
                except Exception as e:
                    msg = f"search {category} {q!r}: {e}"
                    _log(f"  ! {msg}")
                    result.errors.append(msg)
                time.sleep(_SLEEP)

    # 3b. Extra sources (HN / App Store / Play Store / Scholar / SO / Trends / arXiv / …)
    # Fanned out in parallel — each worker hits a distinct provider, so there
    # is no per-host rate contention. Reddit-touching stages above stay
    # sequential (Reddit's rate limits don't tolerate concurrent hits from
    # public mode). The _log lock keeps progress lines atomic so the UI can
    # still split them. SQLite WAL mode (enabled in core.db) lets concurrent
    # writers append without "database is locked" errors.
    if sources:
        from ..sources.collect_adapter import SOURCES

        # Validate up-front so unknown names fail fast with a clear error,
        # not after spending several seconds on valid ones.
        valid: list[str] = []
        for src in sources:
            if src in SOURCES:
                valid.append(src)
            else:
                _log(f"  ! unknown source: {src}")
                result.errors.append(f"unknown source: {src}")

        def _run_source(src: str) -> tuple[str, int | dict | None, Exception | None, float]:
            """Run one source fetch; return (src, value, error, elapsed_s)."""
            t0 = time.monotonic()
            _log(f"[{src}] starting…")
            try:
                fn = SOURCES[src]
                out = fn(topic)
                return (src, out, None, time.monotonic() - t0)
            except Exception as e:
                return (src, None, e, time.monotonic() - t0)

        if valid:
            workers = min(_PARALLEL_SOURCES, len(valid))
            _log(f"[parallel] fetching {len(valid)} sources across {workers} workers…")
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {pool.submit(_run_source, s): s for s in valid}
                done_count = 0
                for fut in as_completed(futures):
                    src, out, err, elapsed = fut.result()
                    done_count += 1
                    prefix = f"[{done_count}/{len(valid)}] [{src}]"
                    if err is not None:
                        msg = f"{prefix} ✗ {err} ({elapsed:.1f}s)"
                        _log(msg)
                        with _log_lock:
                            result.errors.append(f"source:{src}: {err}")
                    elif src == "trends":
                        # trends returns a dict of keyword → trend series, not a post count
                        _log(f"{prefix} ✓ trends series collected ({elapsed:.1f}s)")
                        with _log_lock:
                            result.by_source[f"source:{src}"] = out
                    else:
                        n = int(out or 0)
                        _log(f"{prefix} ✓ {n} posts ({elapsed:.1f}s)")
                        with _log_lock:
                            result.posts_fetched += n
                            result.by_source[f"source:{src}"] = n

    # 4. Historical — pullpush (pre-May-2025)
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
                tagged = _tag_posts(topic, [r["id"] for r in hrows], source=f"pullpush:{sub}")
                result.posts_fetched += tagged
                result.by_source[f"pullpush:{sub}"] = tagged
            except Exception as e:
                msg = f"pullpush {sub}: {e}"
                _log(f"  ! {msg}")
                result.errors.append(msg)
            time.sleep(_SLEEP)

    _log(f"done. {result.posts_fetched} posts tagged for '{topic}'.")
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
        sql = f"""
            SELECT p.id, p.sub, p.author, p.title,
                   substr(p.selftext, 1, 500) AS selftext,
                   p.score, p.num_comments, p.created_utc
            FROM posts p JOIN topic_posts tp ON tp.post_id = p.id
            WHERE tp.topic = ? AND p.score >= ? {where_clause}
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
    """Pull the collected corpus for a topic, newest-engaged first."""
    db = get_db()
    return list(
        db.query(
            """
            SELECT p.id, p.sub, p.author, p.title, p.selftext,
                   p.score, p.num_comments, p.created_utc, p.permalink
            FROM posts p
            JOIN topic_posts tp ON tp.post_id = p.id
            WHERE tp.topic = ? AND p.score >= ?
            ORDER BY (p.num_comments * 2 + p.score) DESC
            LIMIT ?
            """,
            [topic, min_score, limit],
        )
    )
