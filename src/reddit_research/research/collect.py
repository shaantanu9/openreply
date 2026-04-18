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

import time
from dataclasses import dataclass, field
from typing import Any

from ..core.db import get_db
from ..fetch.posts import fetch_posts
from ..fetch.search import search_reddit
from .discover import discover_subs
from .prompts import render_queries

# Politeness delay between HTTP calls — Reddit's public endpoint is tight.
_SLEEP = 2.0


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
    progress=None,  # optional callable(message: str) for CLI progress
) -> CollectResult:
    """Run the full collection for a topic.

    Args:
      subs: override discovery with a user-provided list of sub names.
      limit_per_sub: top-of-month + top-of-year each fetch this many posts.
      limit_per_query: search fetch this many per query template.
      query_categories: subset of ['pain','features','complaints','diy'].
      sub_scope_search: if True, restrict searches to the discovered subs
        (better signal). If False, search all of Reddit.
    """
    result = CollectResult(topic=topic)

    def _log(msg: str) -> None:
        if progress:
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

    _log(f"done. {result.posts_fetched} posts tagged for '{topic}'.")
    return result


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
