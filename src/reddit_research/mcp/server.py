"""FastMCP server exposing read/fetch/query tools.

No LLM calls inside — Claude Code is the LLM. This server is a thin,
deterministic surface over the fetch + DB layers.
"""
from __future__ import annotations

from typing import Any

try:
    from fastmcp import FastMCP
except ImportError as e:  # pragma: no cover
    raise RuntimeError("Install the mcp extra: pip install -e '.[mcp]'") from e

from ..core.db import get_db
from ..fetch.comments import fetch_comments
from ..fetch.posts import fetch_posts
from ..fetch.search import search_reddit
from ..fetch.users import fetch_user
from ..research.collect import collect as research_collect
from ..research.collect import corpus_for as research_corpus_for
from ..research.discover import discover_subs as research_discover

mcp = FastMCP("reddit-myind")


@mcp.tool()
def reddit_fetch_posts(
    sub: str,
    sort: str = "hot",
    limit: int = 50,
    time_filter: str = "day",
) -> list[dict]:
    """Fetch posts from a subreddit and persist to SQLite.

    Args:
        sub: subreddit name (no 'r/' prefix).
        sort: hot | new | top | rising | controversial.
        limit: max posts to return (PRAW paginates internally).
        time_filter: used for top/controversial. hour|day|week|month|year|all.
    """
    return fetch_posts(sub=sub, sort=sort, limit=limit, time_filter=time_filter)  # type: ignore[arg-type]


@mcp.tool()
def reddit_fetch_comments(post_id: str, depth: int | None = None) -> list[dict]:
    """Fetch the full comment tree for a Reddit post ID."""
    return fetch_comments(post_id=post_id, depth=depth)


@mcp.tool()
def reddit_fetch_user(name: str, kind: str = "both", limit: int = 100) -> dict:
    """Fetch a user's recent posts and/or comments.

    Args:
        name: Reddit username.
        kind: posts | comments | both.
        limit: per kind.
    """
    return fetch_user(name=name, kind=kind, limit=limit)  # type: ignore[arg-type]


@mcp.tool()
def reddit_search(
    query: str,
    sub: str | None = None,
    sort: str = "relevance",
    time_filter: str = "all",
    limit: int = 50,
) -> list[dict]:
    """Search Reddit. Scope to a sub with `sub=`, otherwise searches all."""
    return search_reddit(  # type: ignore[arg-type]
        query=query, sub=sub, sort=sort, time_filter=time_filter, limit=limit
    )


@mcp.tool()
def reddit_query_db(sql: str) -> list[dict[str, Any]]:
    """Run a read-only SQL query against the local SQLite store.

    Tables: posts, comments, users, subreddits, fetches, streams, stream_hits.
    Only SELECT statements are allowed.
    """
    s = sql.strip().rstrip(";")
    lower = s.lower()
    if not lower.startswith(("select", "with")):
        raise ValueError("Only SELECT / WITH queries are allowed.")
    if any(k in lower for k in (" insert ", " update ", " delete ", " drop ", " alter ")):
        raise ValueError("Destructive statements are blocked.")
    return list(get_db().query(s))


@mcp.tool()
def reddit_sub_stats(sub: str) -> dict:
    """Summary stats for a sub based on locally stored data."""
    db = get_db()
    sub_l = sub.lower()
    total = db.execute(
        "SELECT count(*) FROM posts WHERE sub=?", [sub_l]
    ).fetchone()[0]
    if total == 0:
        return {"sub": sub_l, "posts_stored": 0, "note": "No data; call reddit_fetch_posts first."}
    agg_row = db.execute(
        "SELECT avg(score), avg(num_comments), max(score), min(created_utc), max(created_utc) "
        "FROM posts WHERE sub=?",
        [sub_l],
    ).fetchone()
    avg_score, avg_comments, max_score, min_created, max_created = agg_row
    top_authors = list(
        db.query(
            "SELECT author, count(*) c FROM posts WHERE sub=? "
            "GROUP BY author ORDER BY c DESC LIMIT 10",
            [sub_l],
        )
    )
    return {
        "sub": sub_l,
        "posts_stored": total,
        "avg_score": round(avg_score or 0, 1),
        "avg_comments": round(avg_comments or 0, 1),
        "max_score": max_score,
        "first_post_utc": min_created,
        "last_post_utc": max_created,
        "top_authors": top_authors,
    }


# ── research tools (gap-finding for any topic/app) ──────────────────────────
# These are the "Claude-drives" tools. No LLM calls inside — Claude Code is
# the LLM, so these return structured data for Claude to synthesize.


@mcp.tool()
def reddit_discover_subs(topic: str, limit: int = 10) -> list[dict]:
    """Find the most relevant subreddits for any topic or app domain.

    Use this as the FIRST step before research_collect so you (Claude) can
    decide whether the auto-discovered subs are right or need tweaking.

    Args:
        topic: e.g. "meditation apps", "freelance invoicing", "resume ATS".
        limit: max subs to return (default 10).
    """
    return research_discover(topic=topic, limit=limit)


@mcp.tool()
def reddit_research_collect(
    topic: str,
    subs: list[str] | None = None,
    limit_per_sub: int = 30,
    limit_per_query: int = 20,
    query_categories: list[str] | None = None,
    scope_to_subs: bool = True,
) -> dict:
    """Build a topic-scoped corpus in SQLite — runs discover + top fetch + parameterized search.

    Fetches ~200–800 posts depending on limits. Takes several minutes.
    All results are tagged with `topic` so later tools can retrieve them.

    Args:
        topic: research topic.
        subs: optional override list (['resumes','jobs',...]). Otherwise discovered.
        limit_per_sub: per-sub top-of-month + top-of-year each fetch this many.
        limit_per_query: per-search-template fetch this many.
        query_categories: subset of ['pain','features','complaints','diy'] (default all).
        scope_to_subs: if True, search each discovered sub separately (higher signal).
    """
    r = research_collect(
        topic=topic,
        subs=subs,
        limit_per_sub=limit_per_sub,
        limit_per_query=limit_per_query,
        query_categories=query_categories,
        sub_scope_search=scope_to_subs,
    )
    return {
        "topic": r.topic,
        "subs": r.subs,
        "posts_fetched": r.posts_fetched,
        "by_source": r.by_source,
        "errors": r.errors[:10],
    }


@mcp.tool()
def reddit_get_corpus(topic: str, limit: int = 50, min_score: int = 1) -> list[dict]:
    """Retrieve the collected corpus for a topic, ranked by engagement.

    Use this to pull the raw posts Claude should analyze. `num_comments * 2 + score`
    is the engagement rank — comments matter more than upvotes for pain signal.

    Args:
        topic: topic tag (matches a prior research_collect call).
        limit: max posts to return.
        min_score: skip posts with score < this.
    """
    return research_corpus_for(topic=topic, limit=limit, min_score=min_score)


@mcp.tool()
def reddit_topic_stats(topic: str) -> dict:
    """Summary stats for a collected topic — size, sub coverage, date range."""
    db = get_db()
    rows = list(
        db.query(
            """
            SELECT count(*) AS n,
                   count(DISTINCT p.sub) AS subs,
                   min(p.created_utc) AS oldest,
                   max(p.created_utc) AS newest,
                   avg(p.num_comments) AS avg_comments,
                   avg(p.score) AS avg_score
            FROM posts p JOIN topic_posts tp ON tp.post_id = p.id
            WHERE tp.topic = ?
            """,
            [topic],
        )
    )
    top_subs = list(
        db.query(
            """
            SELECT p.sub, count(*) AS c
            FROM posts p JOIN topic_posts tp ON tp.post_id = p.id
            WHERE tp.topic = ?
            GROUP BY p.sub ORDER BY c DESC LIMIT 10
            """,
            [topic],
        )
    )
    base = rows[0] if rows else {}
    return {"topic": topic, "stats": base, "top_subs": top_subs}


def run() -> None:
    """Start the server on stdio."""
    mcp.run()
