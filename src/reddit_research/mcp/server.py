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

    Only SELECT / WITH statements are allowed. Destructive keywords are blocked.
    If in doubt about a column name, call `reddit_describe_schema` first —
    the column names below look like the common defaults but there are
    several departures (no `published_at`, no `body`, no `created_at`).

    ─── Primary tables (gotcha columns in bold) ────────────────────────────

    posts(id TEXT pk, sub TEXT, source_type TEXT, author TEXT, title TEXT,
          **selftext TEXT** (NOT "body"), url TEXT, score INT, upvote_ratio,
          num_comments INT, **created_utc FLOAT** (unix secs, NOT "published_at"
          or "created_at"), is_self, over_18, flair, permalink TEXT,
          **fetched_at TEXT** (NOT "indexed_at"))

    comments(id, post_id, parent_id, author, body, score, created_utc FLOAT,
             depth, fetched_at)

    topic_posts(**topic TEXT**, post_id TEXT, source TEXT, added_at TEXT)
        — join post_id ↔ posts.id to pivot posts by topic.

    users(name pk, link_karma, comment_karma, created_utc FLOAT, is_mod, fetched_at)
    subreddits(name pk, subscribers, description, fetched_at)
    fetches(id INT, kind, params_json, started_at, ended_at, rows, error)

    ─── Graph tables (topic knowledge graph) ───────────────────────────────

    graph_nodes(id, topic, kind, label, metadata_json, created_at, ts,
                evidence_post_id)
    graph_edges(src, dst, kind, weight, metadata_json, created_at, topic)

    ─── Enrichment / research tables ──────────────────────────────────────

    topic_insights(topic, report_json, generated_at, corpus_size, provider, model)
    topic_runs(id, topic, run_at, ended_at, trigger, corpus_size,
               findings_count, delta_json, report_hash, error)
    topic_prefs(topic pk, scheduled, last_run_seen, last_run_ts, deleted_at,
                intent, extraction_mode, extraction_threshold, ...)
    topic_canonicalizations(original, canonical, variants_json, confidence, ts,
                            keywords_json)
    topic_aliases(alias_norm, canonical, source, created_at)
    topic_favorites(topic pk, position, added_at)

    paper_analyses(post_id, topic, summary, relevance, takeaway, ts, provider,
                   model)
    mcp_analyses(id, topic, kind, source, tool, params_json, content,
                 content_type, provider, model, tokens_in, tokens_out,
                 created_at)
      — unified log of LLM-driven intelligence (MCP tools + app pipelines).
      `kind` ∈ {summary, synthesis, cluster_note, conclusion, paper_analysis,
      subreddit_ranking, insights, gaps}. GUI topic page reads this.
    hypothesis_tests(id, topic, card_json, status, started_at, resolved_at,
                     resolution_notes, linked_evidence, last_updated, created_at)
    ingested_documents(id, topic, post_id, source_path, source_hash,
                       source_type, parser, parser_mode, artifact_dir, created_at)
    document_elements(id, document_id, post_id, topic, element_id,
                      element_type, content, page_number, bbox_json, created_at)
    extraction_queue(topic, post_id, kind, queued_at, attempted_at, attempts,
                     last_error)
    extraction_daily_usage(day, provider, model, tokens_in, tokens_out, est_usd)
    finding_feedback(id, topic, finding_title, finding_kind, verdict, note,
                     created_at)
    perf_traces(id, op, topic, duration_ms, status, notes, ts)

    ─── Product-mode tables ───────────────────────────────────────────────

    products(id pk, name, one_liner, category, topic, created_at,
             last_swept_at, monitoring_cadence, is_active, metadata_json)
    product_competitors(product_id, competitor_name, urls_json, category,
                        tracked_since, is_active)
    product_signals(id, product_id, signal_type, severity, confidence,
                    detected_at, title, description, evidence_post_ids,
                    related_competitor, suggested_action, user_action,
                    user_action_at, snoozed_until, resolution_notes,
                    created_at)
    product_sweeps(id, product_id, run_at, trigger, signals_generated,
                   posts_added, duration_ms, error, notes)

    ─── Misc ──────────────────────────────────────────────────────────────

    streams(id, name, sub, keywords, started_at, active)
    stream_hits(stream_id, item_type, item_id, matched_at, keywords_matched)
    trend_series(id, topic, keyword, timeframe, geo, point_ts, interest,
                 fetched_at)
    saved_views(id, scope, name, filter_json, pinned, created_at, updated_at)
    prompt_overrides(key pk, override_text, updated_at)

    ─── Date/time conventions ─────────────────────────────────────────────
    - `created_utc` is a FLOAT unix epoch. Format with
      `datetime(created_utc, 'unixepoch')` → `'2026-04-20 12:30:08'`
      or `date(created_utc, 'unixepoch')` → `'2026-04-20'`.
    - Every `*_at` column is an ISO-8601 TEXT string.
    """
    s = sql.strip().rstrip(";")
    lower = s.lower()
    # Allow SELECT, WITH, and a narrow list of read-only PRAGMAs so an LLM
    # client can introspect the schema without hitting the write-guard.
    # Every PRAGMA here is documented as read-only in SQLite's docs.
    _READ_ONLY_PRAGMAS = (
        "pragma table_info",
        "pragma table_list",
        "pragma index_info",
        "pragma index_list",
        "pragma index_xinfo",
        "pragma foreign_key_list",
        "pragma database_list",
        "pragma function_list",
    )
    is_select = lower.startswith(("select", "with"))
    is_ro_pragma = any(lower.startswith(p) for p in _READ_ONLY_PRAGMAS)
    if not (is_select or is_ro_pragma):
        raise ValueError(
            "Only SELECT / WITH / read-only PRAGMA (table_info, table_list, "
            "index_info, index_list, index_xinfo, foreign_key_list, "
            "database_list, function_list) are allowed."
        )
    if any(k in lower for k in (" insert ", " update ", " delete ", " drop ", " alter ")):
        raise ValueError("Destructive statements are blocked.")
    return list(get_db().query(s))


@mcp.tool()
def reddit_describe_schema(table: str | None = None) -> dict[str, Any]:
    """Return live SQLite schema — either every table, or one table.

    Use this when `reddit_query_db` rejects a column ("no such column: …") —
    running `PRAGMA table_info()` is cheaper than guessing and the tool
    description may be stale after a migration.

    Args:
        table: if provided, return columns for that table only. If omitted,
               returns a {table_name: [columns]} map for every user table.

    Returns:
        {"tables": {name: [{name, type, notnull, default, pk}, ...]}} when
        `table` is None, otherwise {"table": name, "columns": [...]}.

        Column rows are the shape SQLite's PRAGMA returns, one per field.
    """
    db = get_db()
    conn = db.conn if hasattr(db, "conn") else db  # sqlite_utils Database → sqlite3 conn

    def cols_for(name: str) -> list[dict[str, Any]]:
        rows = conn.execute(f"PRAGMA table_info({name})").fetchall()
        return [
            {
                "name": r[1],
                "type": r[2],
                "notnull": bool(r[3]),
                "default": r[4],
                "pk": bool(r[5]),
            }
            for r in rows
        ]

    if table:
        # Whitelist: only user tables, never sqlite_* or arbitrary names.
        name = table.strip()
        if not name.replace("_", "").isalnum():
            raise ValueError("table name must be alphanumeric/underscore")
        cols = cols_for(name)
        if not cols:
            raise ValueError(f"table '{name}' not found")
        return {"table": name, "columns": cols}

    tables = [
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
    ]
    return {"tables": {t: cols_for(t) for t in tables}}


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
    result = research_discover(topic=topic, limit=limit)
    # research_discover now returns {subs, confirmation}. MCP consumers
    # expect a plain list — unwrap so the external contract stays stable.
    subs = result.get("subs", []) if isinstance(result, dict) else result
    confirmation = result.get("confirmation", "") if isinstance(result, dict) else ""

    # Persist so the GUI's "AI Analyses" tab sees what the LLM ranked,
    # even when the call came from an MCP client. Silent on any failure —
    # the user ask never depends on this bookkeeping write.
    try:
        from ..core.db import save_mcp_analysis
        import json as _json
        save_mcp_analysis(
            topic=topic,
            kind="subreddit_ranking",
            tool="reddit_discover_subs",
            source="mcp",
            content_type="json",
            content=_json.dumps({"subs": subs, "confirmation": confirmation}),
            params={"topic": topic, "limit": limit},
        )
    except Exception:
        pass

    return subs


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


# ── extended free sources (Batch A/B/C/D) ────────────────────────────────────


@mcp.tool()
def reddit_fetch_arxiv(query: str, limit: int = 30) -> list[dict]:
    """arXiv pre-prints — free, keyless academic source."""
    from ..sources.arxiv import fetch_arxiv

    return fetch_arxiv(query=query, limit=limit)


@mcp.tool()
def reddit_fetch_openalex(query: str, limit: int = 30, year_from: int | None = None) -> list[dict]:
    """OpenAlex — 200M+ works, open scholarly data."""
    from ..sources.openalex import fetch_openalex

    return fetch_openalex(query=query, limit=limit, year_from=year_from)


@mcp.tool()
def reddit_fetch_pubmed(query: str, limit: int = 30) -> list[dict]:
    """PubMed — health/medical research."""
    from ..sources.pubmed import fetch_pubmed

    return fetch_pubmed(query=query, limit=limit)


# ── Paper-research toolkit ────────────────────────────────────────────────────
# Turns Gap Map's MCP into a first-class research tool: citation graphs,
# canonical DOI lookup, LLM paper analysis, and a "search across all 6
# paper sources at once" helper. All results land in `posts` with a
# `source_type='arxiv|pubmed|openalex|scholar|semantic_scholar|crossref'`
# tag so Palace, the graph, and the Solutions Agent pick them up for free.

@mcp.tool()
def reddit_fetch_semantic_scholar(
    query: str,
    limit: int = 30,
    year_from: int | None = None,
    open_access_only: bool = False,
) -> list[dict]:
    """Semantic Scholar — 220M papers, citation graph, influential-citation
    metric (fraction of citations that actually build on the work), TLDR
    summaries. Free; set S2_API_KEY env var to raise rate limits.

    `score` = total citations; `num_comments` = influential citations;
    `upvote_ratio` = influential/total ratio. Use `open_access_only=True`
    when you want to follow through to full text immediately.
    """
    from ..sources.semantic_scholar import fetch_semantic_scholar
    return fetch_semantic_scholar(
        query=query, limit=limit, year_from=year_from,
        open_access_only=open_access_only,
    )


@mcp.tool()
def reddit_paper_citations(paper_id: str, limit: int = 30) -> list[dict]:
    """Papers that cite `paper_id`. Accepts S2 paper_id, DOI (raw '10.xxxx/yy'),
    or arXiv id. Returns row-shaped results ready for upsert. Core
    literature-review move — 'what was built on this?'
    """
    from ..sources.semantic_scholar import fetch_citations
    return fetch_citations(paper_id=paper_id, limit=limit)


@mcp.tool()
def reddit_paper_references(paper_id: str, limit: int = 30) -> list[dict]:
    """Reference list of `paper_id` — papers this one cites. Walk backwards
    through the literature to find foundational work. DOI / S2 / arXiv ids all accepted.
    """
    from ..sources.semantic_scholar import fetch_references
    return fetch_references(paper_id=paper_id, limit=limit)


@mcp.tool()
def reddit_fetch_crossref(
    query: str,
    limit: int = 30,
    year_from: int | None = None,
    filter_type: str | None = None,
) -> list[dict]:
    """Crossref — authoritative DOI metadata for nearly every published
    paper. Best source for venue / page / funder / grant info. `filter_type`
    examples: 'journal-article', 'proceedings-article', 'book-chapter',
    'posted-content' (preprints). Set CROSSREF_MAILTO env var for the
    polite pool (higher rate limits).
    """
    from ..sources.crossref import fetch_crossref
    return fetch_crossref(
        query=query, limit=limit, year_from=year_from, filter_type=filter_type,
    )


@mcp.tool()
def reddit_fetch_by_doi(doi: str) -> dict | None:
    """One-shot canonical Crossref lookup by DOI. Accepts '10.xxxx/yy' or
    'https://doi.org/10.xxxx/yy'. Returns a single row (ready to upsert) or
    null on miss. Use when you have a DOI from somewhere and want full metadata.
    """
    from ..sources.crossref import fetch_by_doi
    return fetch_by_doi(doi)


@mcp.tool()
def reddit_research_papers(
    query: str,
    topic: str | None = None,
    limit_per_source: int = 20,
    sources: list[str] | None = None,
    year_from: int | None = None,
    persist: bool = True,
) -> dict:
    """Multi-source paper search across arXiv, PubMed, OpenAlex, Semantic
    Scholar, Crossref, Scholar in parallel. Deduplicated, persisted (unless
    `persist=False`), tagged to `topic` if provided, and indexed into Palace.

    The paper-research counterpart of `reddit_research_collect`. Use this
    as the first step of any literature review — Claude gets a merged,
    ranked list of papers from every major open source in one call.

    Args:
        query: free-text topic / question.
        topic: optional tag so later tools (semantic_search, graph_build,
            analyze_papers_bulk) can filter to just this slice.
        limit_per_source: papers per source (total ≤ 6× this).
        sources: subset of ['arxiv','pubmed','openalex','semantic_scholar',
            'crossref','scholar']. Defaults to all six.
        year_from: year lower-bound where the source supports it.
        persist: upsert into `posts` + `topic_posts`. Turn off for
            exploratory/read-only previews.

    Returns {ok, query, topic, total, by_source, sample, persisted}.
    """
    from ..sources.arxiv import fetch_arxiv
    from ..sources.pubmed import fetch_pubmed
    from ..sources.openalex import fetch_openalex
    from ..sources.semantic_scholar import fetch_semantic_scholar
    from ..sources.crossref import fetch_crossref
    from ..sources.scholar import fetch_scholar
    from ..core.db import upsert_posts, get_db

    runners = {
        "arxiv":            lambda: fetch_arxiv(query=query, limit=limit_per_source),
        "pubmed":           lambda: fetch_pubmed(query=query, limit=limit_per_source),
        "openalex":         lambda: fetch_openalex(query=query, limit=limit_per_source, year_from=year_from),
        "semantic_scholar": lambda: fetch_semantic_scholar(query=query, limit=limit_per_source, year_from=year_from),
        "crossref":         lambda: fetch_crossref(query=query, limit=limit_per_source, year_from=year_from),
        "scholar":          lambda: fetch_scholar(query=query, limit=limit_per_source, year_from=year_from),
    }
    wanted = [s for s in (sources or list(runners.keys())) if s in runners]

    by_source: dict[str, int] = {}
    all_rows: list[dict] = []
    errors: dict[str, str] = {}
    for src in wanted:
        try:
            rows = runners[src]() or []
            by_source[src] = len(rows)
            all_rows.extend(rows)
        except Exception as e:  # noqa: BLE001
            errors[src] = str(e)[:200]
            by_source[src] = 0

    # Dedupe by id — cross-source overlaps (e.g. arXiv + OpenAlex both
    # indexing the same preprint) keep the first occurrence.
    seen: set[str] = set()
    unique: list[dict] = []
    for r in all_rows:
        pid = r.get("id")
        if pid and pid not in seen:
            seen.add(pid)
            unique.append(r)

    persisted = 0
    if persist and unique:
        persisted = upsert_posts(unique)
        if topic:
            db = get_db()
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc).isoformat(timespec="seconds")
            db["topic_posts"].insert_all(
                [{"topic": topic, "post_id": r["id"], "source": r.get("source_type", ""),
                  "added_at": now} for r in unique],
                pk=("topic", "post_id"), replace=True,
            )

    sample = [
        {"id": r["id"], "title": r.get("title", "")[:140],
         "source_type": r.get("source_type"), "score": r.get("score"),
         "url": r.get("url")}
        for r in sorted(unique, key=lambda r: r.get("score") or 0, reverse=True)[:10]
    ]
    return {
        "ok": True,
        "query": query,
        "topic": topic,
        "total": len(unique),
        "by_source": by_source,
        "errors": errors,
        "persisted": persisted,
        "sample": sample,
    }


@mcp.tool()
def reddit_analyze_paper(topic: str, post_id: str, force: bool = False) -> dict:
    """LLM analysis of one paper — summary, claims, methods, tier, applicability.

    Reads the paper row from `posts` (any academic source_type works) and
    asks the configured LLM to extract:
      - one-paragraph summary
      - key claims (bulleted)
      - methods + sample size
      - evidence tier (meta-analysis / peer-reviewed / expert / anecdote)
      - relevance to `topic`
      - caveats + counter-evidence

    Cached in `paper_analyses` table; pass `force=True` to re-run. Requires
    a configured LLM provider (BYOK). Skip-stub if none configured.
    """
    from ..research.paper_analyze import analyze_paper
    res = analyze_paper(topic=topic, post_id=post_id, force=force)
    # Mirror a compact markdown card into mcp_analyses so the GUI surfaces
    # this analysis without having to join paper_analyses every render.
    try:
        if isinstance(res, dict) and res.get("ok") and not res.get("skipped"):
            from ..core.db import save_mcp_analysis
            md = (
                f"**Summary.** {res.get('summary','').strip()}\n\n"
                f"**Relevance.** {res.get('relevance','').strip()}\n\n"
                f"**Takeaway.** {res.get('takeaway','').strip()}"
            )
            save_mcp_analysis(
                topic=topic,
                kind="paper_analysis",
                tool="reddit_analyze_paper",
                source="mcp",
                content=md,
                params={"topic": topic, "post_id": post_id, "force": force},
                provider=res.get("provider", ""),
                model=res.get("model", ""),
            )
    except Exception:
        pass
    return res


@mcp.tool()
def reddit_analyze_papers_bulk(topic: str, limit: int | None = None, force: bool = False) -> dict:
    """Analyze every academic-source paper tagged to `topic` that doesn't
    already have an analysis. Returns {ok, analyzed, skipped, errored, total}.
    Ordered by citation/score desc so the highest-signal papers go first.
    """
    from ..research.paper_analyze import analyze_papers_bulk
    res = analyze_papers_bulk(topic=topic, limit=limit, force=force)
    # One rollup row, not one per paper — individual paper rows already
    # land via analyze_paper() if the bulk path calls it. This keeps the
    # "AI Analyses" GUI list readable.
    try:
        if isinstance(res, dict) and res.get("ok"):
            from ..core.db import save_mcp_analysis
            md = (
                f"Bulk paper analysis for **{topic}** — "
                f"{res.get('analyzed', 0)} analyzed, "
                f"{res.get('skipped', 0)} skipped, "
                f"{res.get('errored', 0)} errored "
                f"(of {res.get('total', 0)} total)."
            )
            save_mcp_analysis(
                topic=topic,
                kind="conclusion",
                tool="reddit_analyze_papers_bulk",
                source="mcp",
                content=md,
                params={"topic": topic, "limit": limit, "force": force},
            )
    except Exception:
        pass
    return res


@mcp.tool()
def reddit_paper_analyses(topic: str, limit: int = 50) -> list[dict]:
    """Return cached LLM analyses for all papers on `topic`. Fast read —
    no LLM call. Use to pull your growing evidence base into a summary.
    """
    from ..core.db import get_db
    sql = """
        SELECT pa.*, p.title, p.url, p.source_type, p.score
        FROM paper_analyses pa
        JOIN posts p ON p.id = pa.post_id
        WHERE pa.topic = :topic
        ORDER BY coalesce(p.score, 0) DESC
        LIMIT :lim
    """
    return list(get_db().query(sql, {"topic": topic, "lim": limit}))


@mcp.tool()
def reddit_synthesize_insights(
    topic: str,
    min_score: int = 0,
    provider: str | None = None,
) -> dict:
    """Run the insight synthesis pipeline on the topic's corpus and return
    the parsed report. Persists to both `topic_insights` (primary) and
    `mcp_analyses` (GUI surface). LLM-backed — uses the app's configured
    provider chain. Returns {ok, skipped?, report?, error?}.

    Use AFTER fetching enough corpus (≥100 posts recommended). This is the
    "conclusions at the end" step from the GUI's app-mode perspective —
    MCP clients can call it on demand instead of waiting for the app's
    enrichment worker.
    """
    from ..research.insights import synthesize_insights
    import json as _json
    res = synthesize_insights(topic=topic, provider=provider, persist=True, min_score=min_score)
    try:
        if isinstance(res, dict) and res.get("ok") is not False:
            from ..core.db import save_mcp_analysis
            report = res if "findings" in res else res.get("report") or {}
            save_mcp_analysis(
                topic=topic,
                kind="insights",
                tool="reddit_synthesize_insights",
                source="mcp",
                content_type="json",
                content=_json.dumps(report),
                params={"topic": topic, "min_score": min_score, "provider": provider},
                provider=res.get("provider", "") or "",
                model=res.get("model", "") or "",
            )
    except Exception:
        pass
    return res


@mcp.tool()
def reddit_find_gaps(
    topic: str,
    corpus_limit: int = 120,
    min_score: int = 1,
    provider: str | None = None,
) -> dict:
    """Extract painpoints / feature wishes / product complaints / DIY workarounds
    from the topic's corpus. LLM-backed via the app's configured provider.
    Persists the four-part report to `mcp_analyses` so the GUI can show it.
    """
    from ..research.gaps import find_gaps
    import json as _json
    res = find_gaps(topic=topic, provider=provider, corpus_limit=corpus_limit, min_score=min_score)
    try:
        if isinstance(res, dict) and not res.get("error"):
            from ..core.db import save_mcp_analysis
            save_mcp_analysis(
                topic=topic,
                kind="gaps",
                tool="reddit_find_gaps",
                source="mcp",
                content_type="json",
                content=_json.dumps({
                    "painpoints": res.get("painpoints"),
                    "feature_wishes": res.get("feature_wishes"),
                    "product_complaints": res.get("product_complaints"),
                    "diy_workarounds": res.get("diy_workarounds"),
                    "corpus_size": res.get("corpus_size"),
                }),
                params={"topic": topic, "corpus_limit": corpus_limit, "min_score": min_score},
                provider=res.get("provider", "") or "",
            )
    except Exception:
        pass
    return res


@mcp.tool()
def reddit_mcp_analyses_list(
    topic: str | None = None,
    kind: str | None = None,
    limit: int = 50,
) -> list[dict]:
    """List recent entries from `mcp_analyses` — the unified log of
    LLM-driven intelligence across MCP tools and the app's pipelines.

    Use this to show a client LLM (or the GUI) what's already been
    concluded on a topic before running a fresh synthesis. Filter by
    `topic` and/or `kind` ∈ {summary, synthesis, cluster_note, conclusion,
    paper_analysis, subreddit_ranking, insights, gaps}.
    """
    from ..core.db import get_db
    clauses: list[str] = []
    params: dict[str, Any] = {"lim": max(1, min(int(limit), 500))}
    if topic:
        clauses.append("topic = :topic")
        params["topic"] = topic
    if kind:
        clauses.append("kind = :kind")
        params["kind"] = kind
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = f"""
        SELECT id, topic, kind, source, tool, content_type, content,
               provider, model, tokens_in, tokens_out, created_at
        FROM mcp_analyses
        {where}
        ORDER BY created_at DESC, id DESC
        LIMIT :lim
    """
    return list(get_db().query(sql, params))


@mcp.tool()
def reddit_papers_export(topic: str, fmt: str = "bibtex", limit: int | None = None) -> dict:
    """Export a topic's academic papers as BibTeX / RIS / APA / Markdown.

    Perfect for students + researchers: paste the result straight into
    LaTeX (BibTeX), Zotero/Mendeley (RIS), a blog post (APA), or a
    comparison table (Markdown). Reads from `posts` — no LLM call, no
    network. Returns {ok, fmt, topic, count, text}.
    """
    from ..research.paper_export import export_topic
    return export_topic(topic=topic, fmt=fmt, limit=limit)


@mcp.tool()
def reddit_oa_lookup(doi: str) -> dict | None:
    """Unpaywall — find a legal free OA PDF for any DOI.

    ~40% of paywalled papers have a legitimate free copy (author's
    university page, institutional repo, preprint server). Returns
    {doi, is_oa, oa_status, best_oa_url, best_oa_host, ...} or null
    on miss. Set `UNPAYWALL_EMAIL` env var for the polite pool.
    """
    from ..sources.unpaywall import lookup_doi
    return lookup_doi(doi)


@mcp.tool()
def reddit_fetch_gnews(query: str, limit: int = 30, country: str = "US") -> list[dict]:
    """Google News via free RSS — mainstream attention overlay."""
    from ..sources.gnews import fetch_gnews

    return fetch_gnews(query=query, limit=limit, country=country)


@mcp.tool()
def reddit_fetch_devto(query: str | None = None, tag: str | None = None, limit: int = 30) -> list[dict]:
    """DEV.to articles — tech community signal."""
    from ..sources.devto import fetch_devto

    return fetch_devto(query=query, tag=tag, limit=limit)


@mcp.tool()
def reddit_fetch_lemmy(query: str, instance: str = "lemmy.world", limit: int = 30) -> list[dict]:
    """Lemmy — federated Reddit alternative, niche communities."""
    from ..sources.lemmy import fetch_lemmy

    return fetch_lemmy(query=query, instance=instance, limit=limit)


@mcp.tool()
def reddit_fetch_mastodon(query: str, instance: str = "mastodon.social", limit: int = 30) -> list[dict]:
    """Mastodon public tag timeline."""
    from ..sources.mastodon import fetch_mastodon

    return fetch_mastodon(query=query, instance=instance, limit=limit)


@mcp.tool()
def reddit_fetch_bluesky(query: str, limit: int = 30) -> list[dict]:
    """Bluesky (AT Protocol) — public posts matching a query. Free, no key."""
    from ..sources.bluesky import fetch_bluesky
    return fetch_bluesky(query=query, limit=limit)


@mcp.tool()
def reddit_fetch_rss(
    feed_url: str,
    category: str = "rss",
    publication: str = "",
    limit: int = 50,
    query: str | None = None,
) -> list[dict]:
    """Fetch any RSS / Atom feed and persist entries as posts.

    Args:
        feed_url: full RSS / Atom URL (e.g. https://news.ycombinator.com/rss).
        category: free-form tag stored in `sub` (use for filtering later).
        publication: display name for the outlet (blog / newspaper name).
        limit: max entries to return.
        query: optional keyword filter — when set, only entries whose
            title/summary contain one of the query's words are kept.
    """
    from ..sources.rss import fetch_rss
    return fetch_rss(
        feed_url=feed_url, category=category, publication=publication,
        query=query, limit=limit,
    )


@mcp.tool()
def reddit_fetch_producthunt(query: str, limit: int = 30) -> list[dict]:
    """Product Hunt — recent launches matching a query. Useful for 'what
    is everyone launching in this space' + competitor scanning."""
    from ..sources.producthunt import fetch_producthunt
    return fetch_producthunt(query=query, limit=limit)


@mcp.tool()
def reddit_fetch_trustpilot(query: str, pages: int = 3, limit: int = 90) -> list[dict]:
    """Trustpilot — user reviews for a brand. `query` = brand or search term
    (we resolve it to a Trustpilot domain). Useful for product-mode sweeps."""
    from ..sources.trustpilot import fetch_trustpilot
    return fetch_trustpilot(query=query, pages=pages, limit=limit)


@mcp.tool()
def reddit_fetch_alternativeto(product: str, limit: int = 30) -> list[dict]:
    """AlternativeTo — 'what else is out there like X?' Returns competitor
    products with brief descriptions. Input is a product name (e.g. 'Notion')."""
    from ..sources.alternativeto import fetch_alternativeto
    return fetch_alternativeto(product=product, limit=limit)


@mcp.tool()
def reddit_fetch_youtube(query: str, videos: int = 5, comments_per_video: int = 50) -> list[dict]:
    """YouTube — video metadata + top comments for each video on a query.
    Requires `YOUTUBE_API_KEY` env var (free quota: 10K units/day).
    Returns rows shaped like posts — video = parent, comments follow as their own posts."""
    from ..sources.youtube import search_youtube_videos, fetch_youtube_comments
    vids = search_youtube_videos(query=query, limit=videos) or []
    out = list(vids)
    for v in vids:
        vid_id = v.get("id", "").replace("youtube_", "")
        try:
            cs = fetch_youtube_comments(video_id=vid_id, video_title=v.get("title", ""),
                                        limit=comments_per_video) or []
            out.extend(cs)
        except Exception:  # noqa: BLE001
            continue
    return out


@mcp.tool()
def reddit_fetch_discourse(query: str, instance: str, limit: int = 30) -> list[dict]:
    """Search a Discourse forum. `instance` is the forum domain (e.g. forum.obsidian.md)."""
    from ..sources.discourse import fetch_discourse

    return fetch_discourse(query=query, instance=instance, limit=limit)


@mcp.tool()
def reddit_fetch_github_repos(query: str, limit: int = 20) -> list[dict]:
    """Search GitHub repositories — find OSS competitors for a topic."""
    from ..sources.github_trending import search_github_repos

    return search_github_repos(query=query, limit=limit)


@mcp.tool()
def reddit_fetch_github_issues(query: str, limit: int = 30, state: str = "open") -> list[dict]:
    """Search GitHub issues — ranked by 👍 reactions (user pain density)."""
    from ..sources.github_issues import fetch_github_issues

    return fetch_github_issues(query=query, limit=limit, state=state)


@mcp.tool()
def reddit_fetch_wikipedia(topic: str, pageview_days: int = 90) -> dict:
    """Wikipedia summary + pageview time series — topic popularity signal."""
    from ..sources.wikipedia import fetch_wikipedia_pageviews, fetch_wikipedia_summary

    return {
        "summary": fetch_wikipedia_summary(topic),
        "pageviews": fetch_wikipedia_pageviews(topic, days=pageview_days),
    }


@mcp.tool()
def reddit_fetch_package_stats(
    package: str, ecosystem: str = "npm", range_: str = "last-month"
) -> dict:
    """Download stats for a package. ecosystem: 'npm' or 'pypi'."""
    if ecosystem == "npm":
        from ..sources.npmstats import fetch_npm_downloads

        return fetch_npm_downloads(package=package, range_=range_)
    if ecosystem == "pypi":
        from ..sources.pypistats import fetch_pypi_downloads

        return fetch_pypi_downloads(package=package)
    return {"error": f"unknown ecosystem: {ecosystem}"}


# ── graph analysis (NetworkX) ────────────────────────────────────────────────


@mcp.tool()
def reddit_graph_pagerank(topic: str, top_n: int = 20, kind: str | None = None) -> list[dict]:
    """Rank nodes by PageRank — surfaces hidden structural hubs.

    Optionally filter to one kind: 'painpoint', 'product', 'workaround', etc.
    """
    from ..graph.analyze import pagerank_nodes

    return pagerank_nodes(topic=topic, top_n=top_n, kind=kind)


@mcp.tool()
def reddit_graph_communities(topic: str, max_communities: int = 10) -> list[dict]:
    """Louvain community detection — clusters the graph into cohesive groups."""
    from ..graph.analyze import detect_communities

    return detect_communities(topic=topic, max_communities=max_communities)


@mcp.tool()
def reddit_graph_bridges(topic: str, top_n: int = 15) -> list[dict]:
    """Betweenness centrality — structural bridges connecting otherwise-separate clusters."""
    from ..graph.analyze import betweenness_bridges

    return betweenness_bridges(topic=topic, top_n=top_n)


@mcp.tool()
def reddit_graph_structural_summary(topic: str) -> dict:
    """High-level structural metrics (nodes, edges, density, components)."""
    from ..graph.analyze import graph_summary

    return graph_summary(topic=topic)


# ─── Palace (semantic search) tools ────────────────────────────────────────────
# Same ChromaDB + ONNX MiniLM-L6-v2 the desktop app uses (sibling of reddit.db).
# The MCP server pre-warms Palace in run() so the first call here doesn't pay
# the 2-5s cold start. Embeddings flow back into the same `<data_dir>/palace/`
# the app reads — Claude search → app sees → identical hybrid (vector + BM25)
# ranking on both sides.

@mcp.tool()
def reddit_palace_status() -> dict:
    """Is the local semantic index (ChromaDB + ONNX MiniLM-L6-v2) ready?

    Returns: {installed, ready, count, archive_bytes, expected_bytes,
    cache_dir, palace_dir}. If `ready` is False, the user needs to enable
    semantic search in the app (Settings → Semantic search → Enable).
    Use reddit_palace_warmup to trigger that from here.
    """
    from ..retrieval import palace
    s = palace.model_status()
    s.update(palace.stats())
    return s


@mcp.tool()
def reddit_palace_warmup() -> dict:
    """Download + cache the ONNX embedding model (~80 MB, one-time).

    No-op if already cached. After this the palace can answer semantic
    queries in 15-30 ms p50. Returns the final progress event.
    """
    from ..retrieval import palace
    return palace.warmup_model()


@mcp.tool()
def reddit_semantic_search(
    query: str,
    topic: str | None = None,
    source_type: str | None = None,
    k: int = 10,
    rerank: bool = True,
) -> dict:
    """Hybrid semantic + BM25 search over the post corpus (vectorised).

    Args:
        query: free-text query — meaning matches, not just keywords.
        topic: filter to one topic (must match how it was collected).
        source_type: filter to e.g. 'reddit' / 'hn' / 'arxiv' / 'pubmed'.
        k: max results.
        rerank: if True, blend cosine + BM25 (vector_weight=0.6, bm25=0.4).

    Returns: {ok, results: [{id, score, vector_score, bm25_score, text,
    metadata: {topic, source_type, sub, url, author, score, num_comments,
    created_utc}}]}. Each post has the first 600 chars in `text`; use
    reddit_query_db to fetch full body when needed.
    """
    from ..retrieval import palace
    return palace.search_posts(
        query, topic=topic, source_type=source_type, k=k, rerank=rerank,
    )


@mcp.tool()
def reddit_related_posts(post_id: str, k: int = 10, topic: str | None = None) -> dict:
    """Find posts semantically nearest to a given post_id (vector cosine).

    Useful for "more like this" — Claude can pick a high-signal post then
    expand the search radius without thinking up new keywords. Filters
    by topic if provided.
    """
    from ..retrieval import palace
    return palace.related_posts(post_id, k=k, topic=topic)


@mcp.tool()
def reddit_palace_reindex() -> dict:
    """Re-embed every row in `posts` into the palace. Idempotent (~2K posts/min).

    Use after a bulk fetch when the model wasn't ready at upsert time, or
    after changing what fields go into the embedding text. Safe to interrupt;
    next run picks up where it left off because Chroma upserts by id.
    """
    from ..retrieval import palace
    return palace.reindex_all()


# ─── 2026-04-21 Tier-1..6 build — MCP surface for new features ────────
# Exposes every feature we shipped across AG-B..F + FG so external MCP
# clients (Claude Code, Cursor, Claude Desktop) can drive the full app
# programmatically, not just via the desktop UI.

@mcp.tool()
def reddit_topic_soft_delete(topic: str) -> dict:
    """T1.3 — Soft-delete a topic. Hidden from list_topics; recoverable
    for 7 days via `reddit_topic_restore`. Returns
    `{ok, topic, deleted_at, recoverable_until, hidden_posts,
    hidden_graph_nodes}`."""
    from ..research.trash import soft_delete
    return soft_delete(topic)


@mcp.tool()
def reddit_topic_restore(topic: str) -> dict:
    """Restore a soft-deleted topic. Clears topic_prefs.deleted_at."""
    from ..research.trash import restore
    return restore(topic)


@mcp.tool()
def reddit_topic_trash_list() -> list[dict]:
    """List soft-deleted topics with age + post count + expires_in_days."""
    from ..research.trash import list_trash
    return list_trash()


@mcp.tool()
def reddit_topic_trash_purge(min_age_days: int = 7) -> dict:
    """Hard-delete soft-deleted topics older than N days. Default 7."""
    from ..research.trash import purge_older_than
    return purge_older_than(min_age_days=min_age_days)


@mcp.tool()
def reddit_clean_corpus(
    topic: str,
    threshold: float = 0.30,
    apply: bool = False,
    min_keep: int = 20,
) -> dict:
    """Relevance-gate retroactive cleanup. Drops topic_posts rows whose
    cosine-to-topic falls below `threshold`. Dry-run by default; set
    apply=True to actually delete. Guarded by `min_keep` safety floor.
    Returns `{ok, scored, kept, dropped, sample_dropped[]}`."""
    from ..research.relevance import filter_topic_posts
    return filter_topic_posts(topic=topic, threshold=threshold,
                              apply=apply, min_keep=min_keep)


@mcp.tool()
def reddit_find_existing_topic(user_input: str) -> dict:
    """Pre-check before starting a collect — does a semantically-identical
    topic already exist? Returns `{match: {existing_topic, posts}}` or
    `{match: null}`."""
    from ..research.topic_resolver import find_existing_topic
    match = find_existing_topic(user_input) or {}
    return {"ok": True, "user_input": user_input, "match": match or None}


@mcp.tool()
def reddit_merge_duplicate_topics(apply: bool = False) -> dict:
    """Merge LLM-canonicalization-caused duplicate topic rows. Scoped to
    system-caused dupes only (traced via topic_canonicalizations).
    Dry-run by default."""
    from ..research.topic_resolver import merge_duplicate_topics
    return merge_duplicate_topics(dry_run=not apply)


@mcp.tool()
def reddit_collect_quality_check(topic: str) -> dict:
    """T2.2 — Report how many currently-tagged posts would fail the
    lenient vs strict quality gate. Non-mutating diagnostic."""
    from ..core.db import get_db
    from ..research.quality_gate import passes_quality
    db = get_db()
    rows = list(db.query(
        "SELECT p.id, p.title, p.selftext, p.score, p.author "
        "FROM posts p JOIN topic_posts tp ON tp.post_id = p.id "
        "WHERE tp.topic = ?",
        [topic],
    ))
    lenient_fail = [r["id"] for r in rows if not passes_quality(dict(r), strict=False)]
    strict_fail = [r["id"] for r in rows if not passes_quality(dict(r), strict=True)]
    return {
        "ok": True, "topic": topic, "total": len(rows),
        "lenient_fail": len(lenient_fail),
        "strict_fail": len(strict_fail),
        "sample_lenient_fail": lenient_fail[:20],
        "sample_strict_fail": strict_fail[:20],
    }


@mcp.tool()
def reddit_global_competitors(min_topics: int = 2, threshold: float = 0.80) -> list[dict]:
    """T2.5 — Unify competitor mentions across ALL topics. Clusters
    graph_nodes WHERE kind='product' by embedding cosine ≥ threshold.
    Returns `[{canonical_name, aliases[], topics[], total_mentions}]`."""
    from ..research.competitors import global_competitors
    try:
        return global_competitors(min_topics=min_topics, threshold=threshold)
    except TypeError:
        # Older signature fallback
        return global_competitors(min_topics=min_topics)


@mcp.tool()
def reddit_feedback_record(
    topic: str,
    finding_title: str,
    finding_kind: str = "painpoint",
    verdict: str = "wrong",
    note: str = "",
) -> dict:
    """T2.4 — Flag a finding as wrong / off-topic / spam / ok. Fed back
    into next synthesize prompt as a negative-examples block so the LLM
    stops repeating the same mistake."""
    from ..research.feedback import record_feedback
    return record_feedback(
        topic=topic, title=finding_title, kind=finding_kind,
        verdict=verdict, note=note,
    )


@mcp.tool()
def reddit_feedback_list(topic: str | None = None) -> list[dict]:
    """Read back recorded feedback for one topic or globally."""
    from ..core.db import get_db
    db = get_db()
    if "finding_feedback" not in db.table_names():
        return []
    if topic:
        rows = db.query(
            "SELECT id, topic, finding_title, finding_kind, verdict, note, created_at "
            "FROM finding_feedback WHERE topic = ? ORDER BY created_at DESC",
            [topic],
        )
    else:
        rows = db.query(
            "SELECT id, topic, finding_title, finding_kind, verdict, note, created_at "
            "FROM finding_feedback ORDER BY created_at DESC LIMIT 200"
        )
    return list(rows)


@mcp.tool()
def reddit_saved_view_create(
    scope: str,
    name: str,
    filter_json: str,
    pinned: bool = False,
) -> dict:
    """T3.1 — Create a saved-view filter. Scope ∈ 'global' | 'topic:<slug>'
    | 'product:<id>'. filter_json is a JSON string with keys like
    min_opportunity_score / kinds / triangulation_strength_in /
    classification_in."""
    from ..research.saved_views import create_view
    return create_view(
        scope=scope, name=name, filter_json=filter_json, pinned=pinned,
    )


@mcp.tool()
def reddit_saved_view_list(scope: str | None = None) -> list[dict]:
    """List saved views, optionally scoped."""
    from ..research.saved_views import list_views
    return list_views(scope=scope)


@mcp.tool()
def reddit_prompt_list() -> dict:
    """T3.7 — List every extractor prompt key + whether it has an override
    set + previews of bundled and override text."""
    from ..research.prompt_store import list_prompts
    return list_prompts()


@mcp.tool()
def reddit_prompt_get(key: str) -> str:
    """Return the effective prompt text for `key` (override if set,
    otherwise the bundled version)."""
    from ..research.prompt_store import get_prompt
    # Loader returns raw bundled text when no override exists.
    from ..research.prompts import load_extractor

    def _loader():
        try:
            return load_extractor(key)
        except Exception:
            return ""
    result = get_prompt(key, default_loader=_loader)
    if isinstance(result, dict):
        # If bundled returns parsed YAML, re-serialize as a readable string
        import yaml
        return yaml.safe_dump(result, sort_keys=False)
    return str(result or "")


@mcp.tool()
def reddit_prompt_set(key: str, override_text: str) -> dict:
    """Set an extractor prompt override. Empty string clears."""
    from ..research.prompt_store import set_prompt
    set_prompt(key, override_text)
    return {"ok": True, "key": key, "cleared": not override_text}


@mcp.tool()
def reddit_ingest_csv(path: str, topic: str, source_type: str = "csv") -> dict:
    """T3.6 — Bulk-import posts from a CSV with canonical headers
    (post_id, title, body, author, url, created_utc, source_type).
    Only `title` is required. Re-imports deduplicate by post_id.
    Returns `{ok, inserted, tagged, skipped, errors}`."""
    from ..research.ingest import ingest_csv
    return ingest_csv(path=path, topic=topic, source_type_default=source_type)


# ─── Dual-Mode Pivot — Product Mode MCP surface (2026-04-20) ──────────
# The desktop UI is the primary surface but MCP clients (Claude Code,
# Cursor) should also be able to register products, run sweeps, and read
# the daily dashboard programmatically. This adds the most-used endpoints.

@mcp.tool()
def reddit_product_create(
    name: str,
    one_liner: str = "",
    category: str = "",
    topic: str = "",
    competitors: list[dict] | None = None,
) -> dict:
    """Register a Product (your app + competitors)."""
    from ..research.product import create_product
    return create_product(
        name=name, one_liner=one_liner, category=category, topic=topic,
        competitors=competitors or [],
    )


@mcp.tool()
def reddit_product_list(active_only: bool = True) -> list[dict]:
    from ..research.product import list_products
    return list_products(active_only=active_only)


@mcp.tool()
def reddit_product_sweep(
    product_id: str,
    trigger: str = "manual",
    skip_collect: bool = True,
) -> dict:
    """Run the daily sweep for a product. Returns signals generated."""
    from ..research.product_sweep import run_product_sweep
    return run_product_sweep(
        product_id=product_id, trigger=trigger, skip_collect=skip_collect,
    )


@mcp.tool()
def reddit_product_signals(
    product_id: str,
    since_days: int = 7,
    include_resolved: bool = False,
    limit: int = 50,
) -> list[dict]:
    """List open signals for a product, ranked by severity × confidence."""
    from ..research.product_sweep import list_signals
    return list_signals(
        product_id, since_days=since_days,
        include_resolved=include_resolved, limit=limit,
    )


@mcp.tool()
def reddit_product_signal_action(
    signal_id: str,
    action: str,
    notes: str = "",
    snooze_days: int = 7,
) -> dict:
    """Apply a user action to a signal. action ∈ dismissed | acted |
    snoozed | hypothesis. 'hypothesis' seeds a hypothesis_tests row."""
    from ..research.product_sweep import signal_action
    return signal_action(signal_id, action, notes, snooze_days)


@mcp.tool()
def reddit_product_dashboard(product_id: str, days: int = 7) -> dict:
    """One-call fetch for the full product dashboard — product metadata,
    mirror / lens / field sections, recent sweeps, open signals."""
    from ..research.product import get_product
    from ..research.product_digest import (
        build_mirror_section, build_lens_section, build_field_section,
    )
    from ..research.product_sweep import list_signals
    pinfo = get_product(product_id)
    if not pinfo.get("ok"):
        return pinfo
    return {
        "ok": True,
        "product": pinfo["product"],
        "competitors": pinfo["competitors"],
        "recent_sweeps": pinfo["recent_sweeps"],
        "mirror": build_mirror_section(product_id, days=days),
        "lens": build_lens_section(product_id, days=days),
        "field": build_field_section(product_id, days=days),
        "signals": list_signals(product_id, since_days=days,
                                include_resolved=False, limit=50),
    }


@mcp.tool()
def reddit_product_digest(product_id: str, days: int = 7) -> str:
    """Weekly markdown digest for Slack/Notion. Returns plain markdown."""
    from ..research.product_digest import build_digest
    return build_digest(product_id, days=days)


@mcp.tool()
def reddit_product_convert_topic(
    topic: str,
    name: str | None = None,
    one_liner: str = "",
) -> dict:
    """Seed a Product from an existing Topic's graph. Competitors
    auto-extracted from graph_nodes kind in (product, company, competitor)."""
    from ..research.product import convert_topic_to_product
    return convert_topic_to_product(topic=topic, name=name, one_liner=one_liner)


# ─── Graph densification + research linking (2026-04-20 / 04-21) ──────
@mcp.tool()
def reddit_graph_build_relations(topic: str) -> dict:
    """Run the post-pass that emits relates_to / potentially_solves /
    could_address / co_evidenced edges across findings. No LLM cost —
    uses ChromaDB MiniLM. Safe to re-run (upserts)."""
    from ..graph.relations import build_semantic_relations
    return build_semantic_relations(topic)


@mcp.tool()
def reddit_research_link(topic: str, k: int = 3) -> dict:
    """Link each finding to top-K semantically similar academic papers
    in the corpus. Persists to finding_research_links."""
    from ..research.research_linker import link_findings_for_topic
    return link_findings_for_topic(topic=topic, k=k)


@mcp.tool()
def reddit_research_links(topic: str, finding: str | None = None) -> list[dict] | dict:
    """Get linked papers. finding=None → per-finding count summary;
    finding=<title> → list of linked papers with similarity + metadata."""
    from ..research.research_linker import get_links_for_finding, get_links_summary
    if finding:
        return get_links_for_finding(topic=topic, finding_title=finding)
    return get_links_summary(topic=topic)


@mcp.tool()
def reddit_search_all(
    query: str,
    topic: str | None = None,
    aggressive: bool = False,
) -> dict:
    """Cross-table search across posts, graph nodes, analyses, papers,
    hypotheses, feedback, and (aggressive mode) palace semantic hits.

    - normal: SQL LIKE across indexed text columns. Fast, offline.
    - aggressive: LLM query-expansion (3-4 paraphrases) + semantic search.

    Every run persists a summary row to `mcp_analyses` with
    `kind='search'` — so downstream pipelines (insights, concepts,
    solutions) can reuse the result without re-running the search.

    Returns: {ok, query, topic, mode, expansions, buckets, counts, persisted}
    """
    from ..research.search_all import search_all
    return search_all(query=query, topic=topic, aggressive=aggressive, persist=True)


# ─── Production guards — prevents the "18 zombie MCP servers" bug ───
# Shipping lessons from 2026-04-21 — a user session accumulated 18
# `reddit-cli mcp serve` processes over 2 days (Claude Code / Cursor
# reconnects leaked child processes). Each held file locks on the
# palace SQLite + HNSW index; ChromaDB's Rust backend ran continuous
# compaction across all of them, pegging CPU and backing up the Tauri
# sidecar queue. Users saw it as "the app hangs."
#
# Three defensive layers below:
#   1. PID-file lock — refuse to start (or replace) if another MCP
#      server is already running for the same data dir.
#   2. Idle-timeout — self-terminate after N minutes of stdin silence.
#      Catches the case where the MCP client crashes/disconnects
#      without a clean EOF (Cursor restart, Claude Code window close).
#   3. Stale-process sweep — on startup, kill any sibling MCP server
#      that's older than N days AND not the current PID.


def _pidfile_path() -> "object":
    """Path to the MCP server's PID file, alongside the app's data dir.
    Living next to reddit.db ensures each data-dir gets its own lock.
    Uses the single-source-of-truth resolver in core.config so the PID
    file always lands in the same folder as the SQLite DB — regardless
    of how or where the MCP server was spawned."""
    from pathlib import Path
    try:
        from ..core.config import _resolve_data_dir
        base = _resolve_data_dir()
    except Exception:
        base = Path.home() / ".gapmap"
        base.mkdir(parents=True, exist_ok=True)
    return base / "mcp-server.pid"


def _is_alive(pid: int) -> bool:
    """Kill-0 to check if a PID is alive without touching it."""
    import os
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _acquire_pidfile_lock() -> bool:
    """Write our PID to the lock file. Returns True if we got the lock,
    False if another live MCP server already has it.

    Policy:
      - If the stored PID is dead (crash, kill -9), steal the lock.
      - If the stored PID is alive AND ``MCP_TAKEOVER_STALE_LOCK=1``,
        SIGTERM it, wait up to 3 s for it to die, retry. This is the
        normal case when a client (Claude Code / Cursor) restarts and
        spawns a new ``mcp serve`` while the previous one is still
        attached to a dead stdin pipe from the prior session.
      - Otherwise return False — the caller exits with a diagnostic.
    """
    import os
    import signal
    import time

    pf = _pidfile_path()

    def _read_prior() -> int:
        if not pf.exists():
            return 0
        try:
            return int(pf.read_text().strip())
        except (ValueError, OSError):
            return 0

    def _write_ours() -> bool:
        try:
            pf.write_text(str(os.getpid()))
            return True
        except OSError:
            return True  # best-effort — don't block startup on a write failure

    prior = _read_prior()
    if prior and prior != os.getpid() and _is_alive(prior):
        takeover = (os.environ.get("MCP_TAKEOVER_STALE_LOCK") or "").strip().lower() in (
            "1",
            "true",
            "yes",
            "on",
        )
        if not takeover:
            return False
        # Cooperative shutdown. SIGTERM lets the prior server's atexit
        # hooks run (including _release_pidfile_lock), which is cleaner
        # than SIGKILL. Poll for death for up to 3 s, then escalate.
        try:
            os.kill(prior, signal.SIGTERM)
        except (OSError, ProcessLookupError):
            return _write_ours()
        for _ in range(30):  # 30 × 100ms = 3s
            if not _is_alive(prior):
                break
            time.sleep(0.1)
        else:
            try:
                os.kill(prior, signal.SIGKILL)
            except (OSError, ProcessLookupError):
                pass
            time.sleep(0.2)
        if _is_alive(prior):
            # Something else re-acquired the same PID in the interim
            # (rare), or SIGKILL didn't stick. Don't race.
            return False
    return _write_ours()


def _release_pidfile_lock() -> None:
    """Remove the lock on clean exit. atexit-hooked."""
    import os
    pf = _pidfile_path()
    try:
        if pf.exists():
            try:
                stored = int(pf.read_text().strip())
            except (ValueError, OSError):
                stored = 0
            if stored == os.getpid():
                pf.unlink(missing_ok=True)
    except Exception:
        pass


def _sweep_stale_siblings(max_age_days: int = 1) -> int:
    """Kill `reddit-cli mcp serve` processes older than `max_age_days`
    that aren't us. Defensive — in practice users should never have more
    than one running, but past versions leaked them.

    Returns count killed. Best-effort: if `psutil` isn't available or
    the process scan fails, silently returns 0 so we never block startup.
    """
    import os
    import time
    try:
        import psutil  # type: ignore
    except ImportError:
        return 0
    me = os.getpid()
    cutoff = time.time() - (max_age_days * 86400)
    killed = 0
    for p in psutil.process_iter(["pid", "cmdline", "create_time"]):
        try:
            if p.info["pid"] == me:
                continue
            cmd = " ".join(p.info.get("cmdline") or [])
            if "reddit-cli" not in cmd or "mcp" not in cmd or "serve" not in cmd:
                continue
            if (p.info.get("create_time") or 0) > cutoff:
                continue  # too young — might be legit parallel session
            p.terminate()
            killed += 1
        except Exception:
            continue
    return killed


def _start_idle_timeout_guard(timeout_seconds: int) -> None:
    """Background daemon thread — os._exit(0) if stdin has been silent
    AND no tool calls have landed for `timeout_seconds`.

    Why: MCP clients (Claude Code / Cursor) occasionally fail to close
    stdin cleanly on window close / crash — the child hangs forever.
    Self-terminate so we don't accumulate zombies.

    Tracks activity by hooking `sys.stdin.read`; FastMCP's I/O runs
    through stdio and bumps `_last_activity` whenever something arrives.
    """
    import os
    import sys
    import threading
    import time

    # Module-level mutable container so the watcher + hook share state.
    state = {"last": time.time()}

    # Monkey-patch stdin.read* to update last-activity on every read.
    # Cheap and invisible to FastMCP.
    orig_readline = sys.stdin.readline

    def _wrapped_readline(*a, **kw):
        state["last"] = time.time()
        return orig_readline(*a, **kw)

    try:
        sys.stdin.readline = _wrapped_readline  # type: ignore[method-assign]
    except (AttributeError, TypeError):
        pass  # stdin is read-only on some platforms — skip

    def _watcher():
        while True:
            time.sleep(60)
            if time.time() - state["last"] > timeout_seconds:
                sys.stderr.write(
                    f"[mcp] idle-timeout: no stdin activity for {timeout_seconds}s; "
                    f"exiting to prevent zombie accumulation\n"
                )
                sys.stderr.flush()
                os._exit(0)

    t = threading.Thread(target=_watcher, daemon=True, name="mcp-idle-watcher")
    t.start()


def run() -> None:
    """Start the server on stdio.

    Hardened (2026-04-21) against zombie accumulation — see Production
    guards block above for the three-layer defense.

    Startup-time optimisations:

    1. Pre-warm Palace (lazy-init the ChromaDB client + collection handle).
       Costs ~50ms but means the first `reddit_semantic_search` call doesn't
       eat the cold-start. We DON'T eagerly run an embedding here — that's
       a 2-5s ONNX compile and most MCP sessions never touch semantic.
       Set REDDIT_MYIND_PALACE_EAGER=1 to force the embed-warm too.

    2. Read REDDIT_MYIND_TOKEN env var (provisioning marker — plumbed for v2
       enforcement, no-op today).

    3. Tunable idle-timeout via REDDIT_MYIND_IDLE_TIMEOUT (seconds, default
       1800 = 30 min). Set to 0 to disable.

    4. Tunable stale-sibling sweep via REDDIT_MYIND_SWEEP_STALE_DAYS
       (default 1). Set to 0 to disable.
    """
    import atexit
    import os
    import sys

    _ = os.environ.get("REDDIT_MYIND_TOKEN", "")

    # Guard 1 — PID-file lock. If another live instance owns the lock,
    # exit with a clear diagnostic rather than racing. When MCP was
    # installed by the desktop app, MCP_TAKEOVER_STALE_LOCK=1 is set
    # in the client config so a restart automatically reclaims the
    # lock from a zombie prior instance.
    if not _acquire_pidfile_lock():
        import json
        sys.stderr.write(json.dumps({
            "error": "another_mcp_server_running",
            "hint": "Another MCP server instance is still alive. "
                    f"Kill it or remove {_pidfile_path()} if you're sure "
                    "it's dead. To let the server auto-reclaim a stale "
                    "lock on restart, set MCP_TAKEOVER_STALE_LOCK=1 in "
                    "your MCP client's env (or re-run `mcp install` from "
                    "the desktop app, which wires this automatically).",
        }) + "\n")
        sys.stderr.flush()
        raise SystemExit(2)
    atexit.register(_release_pidfile_lock)

    # Guard 3 — sweep stale siblings. Non-blocking; swallows all errors.
    try:
        sweep_days = int(os.environ.get("REDDIT_MYIND_SWEEP_STALE_DAYS", "1"))
    except ValueError:
        sweep_days = 1
    if sweep_days > 0:
        try:
            killed = _sweep_stale_siblings(max_age_days=sweep_days)
            if killed:
                sys.stderr.write(
                    f"[mcp] swept {killed} stale sibling MCP server(s) "
                    f"older than {sweep_days}d\n"
                )
        except Exception:
            pass

    # Guard 2 — idle timeout. Skip when running inside the Tauri sidecar
    # (which already owns process lifecycle) or when disabled via env.
    try:
        idle_seconds = int(os.environ.get("REDDIT_MYIND_IDLE_TIMEOUT", "1800"))
    except ValueError:
        idle_seconds = 1800
    if idle_seconds > 0 and os.environ.get("REDDIT_MYIND_NO_IDLE_GUARD") != "1":
        _start_idle_timeout_guard(idle_seconds)

    # Lazy palace client init — opens the SQLite-backed Chroma store but does
    # NOT load the ONNX model yet. Worst case: chromadb extras missing →
    # silent skip, semantic tools return graceful "not installed" responses.
    try:
        from ..retrieval import palace
        palace.get_palace()  # opens persistent client, ~50ms
        if os.environ.get("REDDIT_MYIND_PALACE_EAGER") in ("1", "true", "yes"):
            if palace.is_model_ready():
                # One throwaway embed → ONNX session compiled + cached for
                # the lifetime of this process. Subsequent semantic calls
                # are pure vector lookups (~15-30 ms p50).
                palace.search_posts("warmup probe", k=1)
    except Exception:
        pass

    mcp.run()
