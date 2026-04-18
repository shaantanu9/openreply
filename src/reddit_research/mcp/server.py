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
from ..fetch.historical import fetch_historical as fetch_historical_fn
from ..fetch.posts import fetch_posts
from ..fetch.search import search_reddit
from ..fetch.users import fetch_user
from ..graph import (
    build_structural as graph_build_structural,
    export_graph_json as graph_export_json,
    graph_stats as graph_stats_fn,
    neighbors as graph_neighbors_fn,
    top_nodes_by_degree as graph_top_nodes,
    upsert_semantic as graph_upsert_semantic,
)
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
    include_historical: bool = False,
    historical_days: int = 730,
    historical_limit_per_sub: int = 500,
    aggressive: bool = False,
) -> dict:
    """Build a topic-scoped corpus (discover + top fetch + parameterized search [+ history]).

    Takes several minutes (more with --historical or --aggressive).
    All results are tagged with `topic` so later tools can retrieve them.

    Args:
        topic: research topic.
        subs: optional override list. Otherwise auto-discovered.
        limit_per_sub: per-sub top-of-month + top-of-year each fetch this many.
        limit_per_query: per-search-template fetch this many.
        query_categories: subset of ['pain','features','complaints','diy'] (default all).
        scope_to_subs: if True, search each discovered sub separately.
        include_historical: also pull pre-May-2025 posts via pullpush archive.
        historical_days: days to look back from May-2025 cutoff.
        historical_limit_per_sub: max historical posts per sub.
        aggressive: preset — maxes limits + all categories + 3-year historical.
    """
    r = research_collect(
        topic=topic,
        subs=subs,
        limit_per_sub=limit_per_sub,
        limit_per_query=limit_per_query,
        query_categories=query_categories,
        sub_scope_search=scope_to_subs,
        include_historical=include_historical,
        historical_days=historical_days,
        historical_limit_per_sub=historical_limit_per_sub,
        aggressive=aggressive,
    )
    return {
        "topic": r.topic,
        "subs": r.subs,
        "posts_fetched": r.posts_fetched,
        "by_source": r.by_source,
        "errors": r.errors[:10],
    }


@mcp.tool()
def reddit_corpus_temporal_split(
    topic: str,
    limit_per_bucket: int = 80,
    min_score: int = 1,
) -> dict:
    """Return the collected corpus split into pre-May-2025 and post-May-2025 buckets.

    Use this for temporal gap analysis — comparing which pain points were chronic
    (pre + post), emerging (post only), or fading (pre only).

    Args:
        topic: topic tag (matches a prior research_collect call).
        limit_per_bucket: max posts per era.
        min_score: skip posts with score < this.
    """
    from ..research.collect import corpus_temporal_split

    return corpus_temporal_split(
        topic=topic, limit_per_bucket=limit_per_bucket, min_score=min_score
    )


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
def reddit_fetch_historical(
    sub: str,
    kind: str = "submission",
    days: int = 365,
    limit: int = 500,
) -> list[dict]:
    """Fetch historical posts/comments from before May 2025 via pullpush archive.

    Use this to get data older than what Reddit's live endpoints return.
    Complements reddit_fetch_posts (which only sees recent data).

    Args:
        sub: subreddit name, no 'r/' prefix.
        kind: 'submission' or 'comment'.
        days: how far back to go from the May-2025 cutoff (1–3650).
        limit: max items (pullpush pages at 100).
    """
    rows = fetch_historical_fn(sub=sub, kind=kind, days=days, limit=limit)  # type: ignore[arg-type]
    return rows


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


# ── graph tools — the virality-enabling layer ───────────────────────────────


@mcp.tool()
def reddit_graph_build(topic: str) -> dict:
    """Build the structural knowledge graph for a topic from collected data.

    Auto-derives topic/subreddit/post/comment/user nodes + containment/
    authorship/era edges from the existing SQLite. No LLM calls; idempotent.
    Run this after reddit_research_collect, before enrichment or export.
    """
    return graph_build_structural(topic)


@mcp.tool()
def reddit_graph_stats(topic: str) -> dict:
    """Return node/edge counts per kind for a topic's graph."""
    return graph_stats_fn(topic)


@mcp.tool()
def reddit_graph_top_nodes(topic: str, kind: str | None = None, limit: int = 20) -> list[dict]:
    """Rank nodes by total degree (hubs). Pass kind to filter (e.g. 'painpoint')."""
    return graph_top_nodes(topic, kind=kind, limit=limit)


@mcp.tool()
def reddit_graph_neighbors(
    topic: str,
    node_id: str,
    edge_kinds: list[str] | None = None,
    direction: str = "both",
    limit: int = 50,
) -> list[dict]:
    """Return neighbors of a node, optionally filtered by edge kind.

    Use after reddit_graph_top_nodes to drill into hubs.
    """
    return graph_neighbors_fn(
        topic=topic, node_id=node_id, edge_kinds=edge_kinds,
        direction=direction, limit=limit,
    )


@mcp.tool()
def reddit_graph_upsert_semantic(
    topic: str,
    painpoints: list[dict] | None = None,
    feature_wishes: list[dict] | None = None,
    product_complaints: list[dict] | None = None,
    diy_workarounds: list[dict] | None = None,
) -> dict:
    """Persist LLM-extracted gap signals as graph nodes + edges.

    Use this after you (Claude) synthesize painpoints / products / workarounds
    from the corpus (reddit_get_corpus). This is the "Claude-as-LLM" path —
    no API key needed on the server side.

    Schemas (all fields optional except the primary label):
      painpoints: [{painpoint, severity, frequency, evidence, classification, example_post_ids}]
      feature_wishes: [{feature, user_quote, frequency, example_post_ids}]
      product_complaints: [{product, complaint, severity, frequency, example_post_ids}]
      diy_workarounds: [{workaround, gap, user_quote, frequency, example_post_ids}]
    """
    return graph_upsert_semantic(
        topic=topic,
        painpoints=painpoints,
        feature_wishes=feature_wishes,
        product_complaints=product_complaints,
        diy_workarounds=diy_workarounds,
    )


@mcp.tool()
def reddit_graph_export_json(topic: str) -> dict:
    """Export the full topic graph as JSON (D3 force-graph shape: nodes, links, meta).

    Returns everything — use sparingly for very large graphs. For selective
    slicing, use reddit_graph_top_nodes + reddit_graph_neighbors instead.
    """
    return graph_export_json(topic)


# ── multi-source tools (free sources — no API keys) ─────────────────────────


@mcp.tool()
def reddit_fetch_hn(query: str, tags: str = "story", limit: int = 30) -> list[dict]:
    """Search Hacker News via the free Algolia API. `tags`: story | comment | ask_hn | show_hn."""
    from ..sources.hackernews import fetch_hn

    return fetch_hn(query=query, tags=tags, limit=limit)


@mcp.tool()
def reddit_fetch_appstore(topic: str, country: str = "us", apps: int = 5, pages_per_app: int = 3) -> dict:
    """Discover top iOS apps for a topic + pull reviews. Returns {apps, reviews_count}."""
    from ..sources.appstore import fetch_appstore_reviews, search_appstore_apps
    from ..core.db import upsert_posts

    found = search_appstore_apps(topic, country=country, limit=apps)
    total = 0
    for a in found:
        if not a.get("track_id"):
            continue
        revs = fetch_appstore_reviews(
            a["track_id"], app_name=a.get("name") or "",
            country=country, pages=pages_per_app, max_reviews=pages_per_app * 50,
        )
        upsert_posts(revs)
        total += len(revs)
    return {"apps": found, "reviews_count": total}


@mcp.tool()
def reddit_fetch_playstore(topic: str, apps: int = 5, reviews_per_app: int = 100) -> dict:
    """Discover top Play Store apps + pull reviews. Returns {apps, reviews_count}."""
    from ..sources.playstore import fetch_playstore_reviews, search_playstore_apps
    from ..core.db import upsert_posts

    found = search_playstore_apps(topic, limit=apps)
    total = 0
    for a in found:
        if not a.get("app_id"):
            continue
        revs = fetch_playstore_reviews(a["app_id"], count=reviews_per_app)
        upsert_posts(revs)
        total += len(revs)
    return {"apps": found, "reviews_count": total}


@mcp.tool()
def reddit_fetch_scholar(query: str, limit: int = 30, year_from: int | None = None) -> list[dict]:
    """Search academic papers on Semantic Scholar (free, no key)."""
    from ..sources.scholar import fetch_scholar

    return fetch_scholar(query=query, limit=limit, year_from=year_from)


@mcp.tool()
def reddit_fetch_stackoverflow(
    query: str | None = None, tag: str | None = None, limit: int = 30
) -> list[dict]:
    """Search Stack Overflow — dev-tool pain signal."""
    from ..sources.stackoverflow import fetch_stackoverflow

    return fetch_stackoverflow(query=query, tag=tag, limit=limit)


@mcp.tool()
def reddit_fetch_trends(
    topic: str,
    keywords: list[str] | None = None,
    timeframe: str = "today 5-y",
    geo: str = "",
) -> dict:
    """Google Trends interest-over-time + rising queries. Demand-validation overlay."""
    from ..sources.trends import fetch_trends

    return fetch_trends(topic=topic, keywords=keywords, timeframe=timeframe, geo=geo)


def run() -> None:
    """Start the server on stdio."""
    mcp.run()
