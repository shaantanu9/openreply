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

mcp = FastMCP("openreply")

# ── Tool registry (for the async-job dispatcher) ──────────────────────────
# `openreply_jobs_submit(tool_name, args)` needs to look up the underlying
# Python function for any registered tool. The logging wrapper below
# populates this dict at registration time so jobs.submit() can dispatch
# without depending on FastMCP's internal registries (which differ
# between fastmcp versions).
_TOOL_REGISTRY: dict[str, Any] = {}


# ── Per-tool logging shim ─────────────────────────────────────────────────
# Wrap FastMCP's `@mcp.tool()` so every registered tool gets its call/error
# events into the structured log. Done here (rather than per-tool boilerplate)
# so all 90+ existing decorators keep working unchanged. Slow tools also
# surface in `mcp stats --slow` because we record duration_ms on success.
def _wrap_tool_for_logging(orig_decorator):
    """Return a drop-in replacement for `mcp.tool()` that wraps the
    decorated function with timing + error logging. Mirrors FastMCP's
    decorator-with-args calling convention: `@mcp.tool()` and `@mcp.tool(...)`
    both call this and the inner returned wrapper handles the function.
    """
    import functools, time as _t, traceback as _tb

    def _outer(*dec_args, **dec_kwargs):
        # Re-apply the original FastMCP decorator first to register the
        # tool with its discovery/schema machinery — we only intercept
        # the runtime call, not registration.
        registrar = orig_decorator(*dec_args, **dec_kwargs)

        def _bind(fn):
            tool_name = getattr(fn, "__name__", "<unknown>")
            # Record the underlying callable so openreply_jobs_submit can
            # dispatch by name without relying on FastMCP's private API.
            # Last-write-wins if a name is reused (matches FastMCP).
            _TOOL_REGISTRY[tool_name] = fn

            @functools.wraps(fn)
            def _logged(*args, **kwargs):
                # We already imported logger at startup; cheap re-import here
                # so this wrapper still works in test contexts that patch
                # the module out from under us.
                from .logger import log_event as _log
                # Mark the session as active for the idle-timeout watcher.
                # Done at entry AND again at exit so a long-running tool
                # call doesn't trigger a mid-call idle-shutdown.
                _bump_activity()
                t0 = _t.time()
                try:
                    out = fn(*args, **kwargs)
                except Exception as e:
                    duration_ms = int((_t.time() - t0) * 1000)
                    _log(
                        "tool_error",
                        severity="error",
                        message=f"{type(e).__name__}: {e}",
                        tool_name=tool_name,
                        duration_ms=duration_ms,
                        details={
                            "traceback": _tb.format_exc()[:6000],
                            # Truncate args — large blobs (corpus dumps,
                            # huge SQL queries) shouldn't bloat the log.
                            "args_preview": str(args)[:400],
                            "kwargs_preview": str(kwargs)[:400],
                        },
                    )
                    raise
                duration_ms = int((_t.time() - t0) * 1000)
                # Slow-call threshold — flag anything >5s as `warn` so
                # `mcp stats --severity warn` surfaces them.
                severity = "warn" if duration_ms > 5000 else "info"
                _log(
                    "tool_call",
                    severity=severity,
                    message=f"ok ({duration_ms} ms)",
                    tool_name=tool_name,
                    duration_ms=duration_ms,
                )
                _bump_activity()  # second bump on exit (covers slow tools)
                return out

            # Hand the LOGGED function to FastMCP's registrar so the
            # JSON-RPC dispatcher invokes our wrapper, not the bare fn.
            return registrar(_logged)

        return _bind

    return _outer

mcp.tool = _wrap_tool_for_logging(mcp.tool)  # type: ignore[assignment]


# ── Hard-timeout safety net for long-running tools ────────────────────
# MCP transports (stdio/SSE) don't tolerate single-call durations past
# ~60-120s on most clients (the connection looks "hung" and the client
# terminates). Long pipelines should use `openreply_jobs_submit(...)` for
# true backgrounding — but heavy synchronous tools (synthesize, paper
# draft, gaps) still need a hard ceiling so a stuck LLM call can never
# kill the session. The helper runs the body on a worker thread and
# raises a helpful "job_id" hint if it exceeds the deadline, telling
# the caller exactly which async tool to use instead.
_DEFAULT_TOOL_TIMEOUT_S = 90.0


def _run_with_timeout(fn, *, timeout: float, async_hint: str | None = None,
                      args=(), kwargs=None):
    """Run `fn` on a thread, return result or a structured timeout dict.

    `async_hint`, if supplied, is the tool name to recommend for async
    execution. Returns a dict on timeout (never raises) so MCP schema
    validation always passes."""
    import concurrent.futures as _fut
    kwargs = kwargs or {}
    with _fut.ThreadPoolExecutor(max_workers=1) as _ex:
        fut = _ex.submit(fn, *args, **kwargs)
        try:
            return fut.result(timeout=timeout)
        except _fut.TimeoutError:
            msg = (
                f"Tool exceeded {timeout:.0f}s ceiling. "
                f"Re-run via openreply_jobs_submit("
                f"{async_hint!r}, args) — that returns a job_id you "
                f"can poll with openreply_jobs_get."
            ) if async_hint else (
                f"Tool exceeded {timeout:.0f}s ceiling. "
                f"This usually means the LLM provider is slow — retry "
                f"or switch provider in Settings."
            )
            return {
                "ok": False, "timed_out": True,
                "timeout_seconds": timeout,
                "error": msg,
                "async_alternative": async_hint,
            }


@mcp.tool()
def openreply_fetch_posts(
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
def openreply_fetch_comments(post_id: str, depth: int | None = None) -> list[dict]:
    """Fetch the full comment tree for a Reddit post ID."""
    return fetch_comments(post_id=post_id, depth=depth)


@mcp.tool()
def openreply_fetch_user(name: str, kind: str = "both", limit: int = 100) -> dict:
    """Fetch a user's recent posts and/or comments.

    Args:
        name: Reddit username.
        kind: posts | comments | both.
        limit: per kind.
    """
    return fetch_user(name=name, kind=kind, limit=limit)  # type: ignore[arg-type]


@mcp.tool()
def openreply_search(
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
def openreply_query_db(sql: str) -> list[dict[str, Any]]:
    """Run a read-only SQL query against the local SQLite store.

    Only SELECT / WITH statements are allowed. Destructive keywords are blocked.
    If in doubt about a column name, call `openreply_describe_schema` first —
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
    # Retry once on transient `database is locked` / `disk I/O error`
    # caused by a concurrent palace upsert or stale WAL frames. The
    # `get_db()` self-heal already runs at first boot; this catches
    # races during the same session.
    import sqlite3 as _sqlite3
    import time as _time
    try:
        return list(get_db().query(s))
    except (_sqlite3.OperationalError, _sqlite3.DatabaseError) as e:
        msg = str(e).lower()
        if "locked" in msg or "i/o error" in msg or "disk i/o" in msg:
            _time.sleep(0.4)
            try:
                return list(get_db().query(s))
            except Exception as e2:
                # Force a new per-thread handle on the second failure so
                # the next call doesn't keep tripping on a stuck cursor.
                try:
                    get_db.cache_clear()  # type: ignore[attr-defined]
                except Exception:
                    pass
                raise e2
        raise


@mcp.tool()
def openreply_describe_schema(table: str | None = None) -> dict[str, Any]:
    """Return live SQLite schema — either every table, or one table.

    Use this when `openreply_query_db` rejects a column ("no such column: …") —
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
def openreply_sub_stats(sub: str) -> dict:
    """Summary stats for a sub based on locally stored data."""
    db = get_db()
    sub_l = sub.lower()
    total = db.execute(
        "SELECT count(*) FROM posts WHERE sub=?", [sub_l]
    ).fetchone()[0]
    if total == 0:
        return {"sub": sub_l, "posts_stored": 0, "note": "No data; call openreply_fetch_posts first."}
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
def openreply_discover_subs(topic: str, limit: int = 10) -> list[dict]:
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
            tool="openreply_discover_subs",
            source="mcp",
            content_type="json",
            content=_json.dumps({"subs": subs, "confirmation": confirmation}),
            params={"topic": topic, "limit": limit},
        )
    except Exception:
        pass

    return subs


@mcp.tool()
def openreply_collect(
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
    from . import jobs as _jobs
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
        # When invoked via openreply_jobs_submit, progress=msgs flow into
        # the job row's progress_msg (and progress_pct heuristically).
        # Outside a job this is a no-op.
        progress=_jobs.make_progress_logger(prefix="[collect] "),
    )
    return {
        "topic": r.topic,
        "subs": r.subs,
        "posts_fetched": r.posts_fetched,
        "by_source": r.by_source,
        "errors": r.errors[:10],
    }


@mcp.tool()
def openreply_corpus_temporal_split(
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
def openreply_get_corpus(topic: str, limit: int = 50, min_score: int = 1) -> list[dict]:
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
def openreply_fetch_historical(
    sub: str,
    kind: str = "submission",
    days: int = 365,
    limit: int = 500,
) -> list[dict]:
    """Fetch historical posts/comments from before May 2025 via pullpush archive.

    Use this to get data older than what Reddit's live endpoints return.
    Complements openreply_fetch_posts (which only sees recent data).

    Args:
        sub: subreddit name, no 'r/' prefix.
        kind: 'submission' or 'comment'.
        days: how far back to go from the May-2025 cutoff (1–3650).
        limit: max items (pullpush pages at 100).
    """
    rows = fetch_historical_fn(sub=sub, kind=kind, days=days, limit=limit)  # type: ignore[arg-type]
    return rows


@mcp.tool()
def openreply_topic_stats(topic: str) -> dict:
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
def openreply_graph_build(topic: str) -> dict:
    """Build the structural knowledge graph for a topic from collected data.

    Auto-derives topic/subreddit/post/comment/user nodes + containment/
    authorship/era edges from the existing SQLite. No LLM calls; idempotent.
    Run this after openreply_collect, before enrichment or export.
    """
    return graph_build_structural(topic)


@mcp.tool()
def openreply_graph_stats(topic: str) -> dict:
    """Return node/edge counts per kind for a topic's graph."""
    return graph_stats_fn(topic)


@mcp.tool()
def openreply_graph_top_nodes(topic: str, kind: str | None = None, limit: int = 20) -> list[dict]:
    """Rank nodes by total degree (hubs). Pass kind to filter (e.g. 'painpoint')."""
    return graph_top_nodes(topic, kind=kind, limit=limit)


@mcp.tool()
def openreply_graph_neighbors(
    topic: str,
    node_id: str,
    edge_kinds: list[str] | None = None,
    direction: str = "both",
    limit: int = 50,
) -> list[dict]:
    """Return neighbors of a node, optionally filtered by edge kind.

    Use after openreply_graph_top_nodes to drill into hubs.
    """
    return graph_neighbors_fn(
        topic=topic, node_id=node_id, edge_kinds=edge_kinds,
        direction=direction, limit=limit,
    )


@mcp.tool()
def openreply_graph_upsert_semantic(
    topic: str,
    painpoints: list[dict] | None = None,
    feature_wishes: list[dict] | None = None,
    product_complaints: list[dict] | None = None,
    diy_workarounds: list[dict] | None = None,
) -> dict:
    """Persist LLM-extracted gap signals as graph nodes + edges.

    Use this after you (Claude) synthesize painpoints / products / workarounds
    from the corpus (openreply_get_corpus). This is the "Claude-as-LLM" path —
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
def openreply_graph_export_json(topic: str) -> dict:
    """Export the full topic graph as JSON (D3 force-graph shape: nodes, links, meta).

    Returns everything — use sparingly for very large graphs. For selective
    slicing, use openreply_graph_top_nodes + openreply_graph_neighbors instead.
    """
    return graph_export_json(topic)


# ── multi-source tools (free sources — no API keys) ─────────────────────────


@mcp.tool()
def openreply_fetch_hn(query: str, tags: str = "story", limit: int = 30) -> list[dict]:
    """Search Hacker News via the free Algolia API. `tags`: story | comment | ask_hn | show_hn."""
    from ..sources.hackernews import fetch_hn

    return fetch_hn(query=query, tags=tags, limit=limit)


@mcp.tool()
def openreply_fetch_appstore(topic: str, country: str = "us", apps: int = 5, pages_per_app: int = 3) -> dict:
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
def openreply_fetch_playstore(topic: str, apps: int = 5, reviews_per_app: int = 100) -> dict:
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
def openreply_fetch_scholar(query: str, limit: int = 30, year_from: int | None = None) -> list[dict]:
    """Search academic papers on Semantic Scholar (free, no key)."""
    from ..sources.scholar import fetch_scholar

    return fetch_scholar(query=query, limit=limit, year_from=year_from)


@mcp.tool()
def openreply_fetch_stackoverflow(
    query: str | None = None, tag: str | None = None, limit: int = 30
) -> list[dict]:
    """Search Stack Overflow — dev-tool pain signal."""
    from ..sources.stackoverflow import fetch_stackoverflow

    return fetch_stackoverflow(query=query, tag=tag, limit=limit)


@mcp.tool()
def openreply_fetch_trends(
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
def openreply_fetch_arxiv(query: str, limit: int = 30) -> list[dict]:
    """arXiv pre-prints — free, keyless academic source."""
    from ..sources.arxiv import fetch_arxiv

    return fetch_arxiv(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_openalex(query: str, limit: int = 30, year_from: int | None = None) -> list[dict]:
    """OpenAlex — 200M+ works, open scholarly data."""
    from ..sources.openalex import fetch_openalex

    return fetch_openalex(query=query, limit=limit, year_from=year_from)


@mcp.tool()
def openreply_fetch_pubmed(query: str, limit: int = 30) -> list[dict]:
    """PubMed — health/medical research."""
    from ..sources.pubmed import fetch_pubmed

    return fetch_pubmed(query=query, limit=limit)


# ── Paper-research toolkit ────────────────────────────────────────────────────
# Turns OpenReply's MCP into a first-class research tool: citation graphs,
# canonical DOI lookup, LLM paper analysis, and a "search across all 6
# paper sources at once" helper. All results land in `posts` with a
# `source_type='arxiv|pubmed|openalex|scholar|semantic_scholar|crossref'`
# tag so Palace, the graph, and the Solutions Agent pick them up for free.

@mcp.tool()
def openreply_fetch_semantic_scholar(
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
def openreply_fetch_crossref(
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
def openreply_fetch_by_doi(doi: str) -> dict | None:
    """One-shot canonical Crossref lookup by DOI. Accepts '10.xxxx/yy' or
    'https://doi.org/10.xxxx/yy'. Returns a single row (ready to upsert) or
    null on miss. Use when you have a DOI from somewhere and want full metadata.
    """
    from ..sources.crossref import fetch_by_doi
    return fetch_by_doi(doi)


# ─── Paper sections + chunks + citations (gap-finding stack) ────────────────


@mcp.tool()
def openreply_flow_status(topic: str) -> dict:
    """Per-project research-flow progress (gather→read→synthesize→write):
    papers, fulltext, chunked, analyzed, lit_matrix, read/reading/to_read,
    has_draft, and normalized stage fractions."""
    from ..research.flow_status import flow_status
    return flow_status(topic)


@mcp.tool()
def openreply_import_gummysearch(path: str) -> dict:
    """Import a GummySearch export (JSON or CSV of saved subreddits/audiences)
    so users keep their curated audiences after GummySearch shuts down (Nov
    2026). Returns {ok, imported, audiences}."""
    from ..sources import gummysearch_import
    return gummysearch_import.import_file(path)


@mcp.tool()
def openreply_oa_lookup(doi: str) -> dict | None:
    """Unpaywall — find a legal free OA PDF for any DOI.

    ~40% of paywalled papers have a legitimate free copy (author's
    university page, institutional repo, preprint server). Returns
    {doi, is_oa, oa_status, best_oa_url, best_oa_host, ...} or null
    on miss. Set `UNPAYWALL_EMAIL` env var for the polite pool.
    """
    from ..sources.unpaywall import lookup_doi
    return lookup_doi(doi)


@mcp.tool()
def openreply_fetch_gnews(query: str, limit: int = 30, country: str = "US") -> list[dict]:
    """Google News via free RSS — mainstream attention overlay."""
    from ..sources.gnews import fetch_gnews

    return fetch_gnews(query=query, limit=limit, country=country)


# ── miroclaw-derived external sources ────────────────────────────────
@mcp.tool()
def openreply_fetch_gdelt(query: str, limit: int = 50, country: str | None = None) -> list[dict]:
    """GDELT global news/events — structured, date-range-capable, keyless.

    `country` is an optional FIPS code (e.g. 'IN', 'US') to scope coverage.
    """
    from ..sources.gdelt import fetch_gdelt

    return fetch_gdelt(query=query, limit=limit, country=country)


@mcp.tool()
def openreply_fetch_duckduckgo(query: str, limit: int = 25) -> list[dict]:
    """DuckDuckGo web search — general web context, keyless (best-effort)."""
    from ..sources.duckduckgo import fetch_duckduckgo

    return fetch_duckduckgo(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_tavily(query: str, limit: int = 15) -> list[dict]:
    """Tavily web search — LLM-grade results. Needs TAVILY_API_KEY (free)."""
    from ..sources.tavily import fetch_tavily

    return fetch_tavily(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_worldbank(query: str, limit: int = 7, country: str | None = None) -> list[dict]:
    """World Bank macro indicators (GDP, CPI, …) as text-summary rows. Keyless.

    `country` is an ISO code (e.g. 'USA', 'IND'); inferred from `query` if omitted.
    """
    from ..sources.worldbank import fetch_worldbank

    return fetch_worldbank(query=query, limit=limit, country=country)


@mcp.tool()
def openreply_fetch_fred(query: str, limit: int = 6) -> list[dict]:
    """FRED US macro series as text-summary rows. Needs FRED_API_KEY (free)."""
    from ..sources.fred import fetch_fred

    return fetch_fred(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_bis(query: str, limit: int = 6) -> list[dict]:
    """BIS central-bank policy rates as text-summary rows. Keyless."""
    from ..sources.bis import fetch_bis

    return fetch_bis(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_yfinance(query: str, limit: int = 6) -> list[dict]:
    """Yahoo Finance quotes (index/stock/commodity) as text-summary rows. Keyless."""
    from ..sources.yfinance_src import fetch_yfinance

    return fetch_yfinance(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_openmeteo(query: str, limit: int = 5) -> list[dict]:
    """Open-Meteo weather (current + 1940+ archive) as text-summary rows. Keyless."""
    from ..sources.openmeteo import fetch_openmeteo

    return fetch_openmeteo(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_acled(query: str, limit: int = 30, country: str | None = None) -> list[dict]:
    """ACLED conflict/protest events. Needs ACLED_EMAIL + ACLED_PASSWORD (free)."""
    from ..sources.acled import fetch_acled

    return fetch_acled(query=query, limit=limit, country=country)


# ── Social + prediction-market + extra academic sources ──────────────────────
# Ad-hoc per-source fetch tools (preview without persisting). The same sources
# are also collectable in bulk via openreply_collect (SOURCES dispatch). Keep these
# in sync with sources/collect_adapter.py:SOURCES.
@mcp.tool()
def openreply_fetch_polymarket(query: str, limit: int = 20) -> list[dict]:
    """Polymarket prediction-market questions + odds as text-summary rows. Keyless."""
    from ..sources.polymarket import fetch_polymarket

    return fetch_polymarket(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_truthsocial(query: str, limit: int = 30) -> list[dict]:
    """Truth Social posts. Needs TRUTHSOCIAL_TOKEN."""
    from ..sources.truthsocial import fetch_truthsocial

    return fetch_truthsocial(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_digg(query: str, limit: int = 20) -> list[dict]:
    """Digg posts. Needs the digg-pp-cli binary on PATH."""
    from ..sources.digg import fetch_digg

    return fetch_digg(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_tiktok(query: str, limit: int = 20) -> list[dict]:
    """TikTok videos/captions. Needs SCRAPECREATORS_API_KEY."""
    from ..sources.tiktok import fetch_tiktok

    return fetch_tiktok(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_instagram(query: str, limit: int = 20) -> list[dict]:
    """Instagram posts/captions. Needs SCRAPECREATORS_API_KEY."""
    from ..sources.instagram import fetch_instagram

    return fetch_instagram(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_threads(query: str, limit: int = 20) -> list[dict]:
    """Threads posts. Needs SCRAPECREATORS_API_KEY."""
    from ..sources.threads import fetch_threads

    return fetch_threads(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_pinterest(query: str, limit: int = 20) -> list[dict]:
    """Pinterest pins. Needs SCRAPECREATORS_API_KEY."""
    from ..sources.pinterest import fetch_pinterest

    return fetch_pinterest(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_x(query: str, limit: int = 20) -> list[dict]:
    """X / Twitter posts. Needs AUTH_TOKEN+CT0 (cookies) | XAI_API_KEY | XQUIK_API_KEY."""
    from ..sources.x_twitter import fetch_x

    return fetch_x(query=query, limit=limit)


# ── Agent Reach ports (2026-06-16) ───────────────────────────────────
@mcp.tool()
def openreply_fetch_v2ex(query: str, limit: int = 50) -> list[dict]:
    """V2EX (Chinese dev/tech community) hot topics, filtered by query. Keyless."""
    from ..sources.v2ex import fetch_v2ex

    return fetch_v2ex(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_bilibili(query: str, limit: int = 50) -> list[dict]:
    """Bilibili (China's largest video community) search. Keyless (optional BILIBILI_PROXY)."""
    from ..sources.bilibili import fetch_bilibili

    return fetch_bilibili(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_xueqiu(query: str, limit: int = 50) -> list[dict]:
    """Xueqiu (雪球, Chinese investor social network) status search. Cookie-warm, keyless."""
    from ..sources.xueqiu import fetch_xueqiu

    return fetch_xueqiu(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_xiaohongshu(query: str, limit: int = 30) -> list[dict]:
    """Xiaohongshu (小红书 / RED) note search. Needs a connected cookie (Reach Connections)."""
    from ..sources.xiaohongshu import fetch_xiaohongshu

    return fetch_xiaohongshu(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_exa(query: str, limit: int = 30) -> list[dict]:
    """Exa neural web search. Needs EXA_API_KEY (free tier) or a connected Exa key."""
    from ..sources.exa_search import fetch_exa_search

    return fetch_exa_search(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_reddit_free(query: str, limit: int = 50, sub: str | None = None) -> list[dict]:
    """Reddit search via the free cookie/proxy path (RSS fallback). Full score/comments
    when a reddit_session cookie is connected; otherwise titles/bodies via RSS."""
    from ..sources.reddit_free import fetch_reddit_free

    return fetch_reddit_free(query=query, sub=sub, limit=limit)


@mcp.tool()
def openreply_read_web(url: str) -> list[dict]:
    """Read any URL → clean markdown via Jina Reader (one post row). Keyless."""
    from ..sources.web_reader import fetch_web_reader

    return fetch_web_reader(url)


@mcp.tool()
def openreply_read_linkedin(url: str) -> list[dict]:
    """Read a public LinkedIn URL (profile/company/post) via Jina → one post row."""
    from ..sources.linkedin import fetch_linkedin

    return fetch_linkedin(url)


@mcp.tool()
def openreply_read_xiaoyuzhou(url: str) -> list[dict]:
    """Read a Xiaoyuzhou (小宇宙) podcast episode URL → title + show notes (one row)."""
    from ..sources.xiaoyuzhou import fetch_xiaoyuzhou

    return fetch_xiaoyuzhou(url)


@mcp.tool()
def openreply_creds_list() -> list[dict]:
    """Status of every cookie/key-gated source for the Reach Connections UI.
    Returns [{source, connected, username, kind, last_verified_at, login_url}]."""
    from ..research.reach_connections import list_connections

    return list_connections()


@mcp.tool()
def openreply_creds_verify(source: str) -> dict:
    """Re-test a connected source's credential by issuing a live fetch.
    Returns {source, connected, message, username}."""
    from ..research.reach_connections import verify_connection

    return verify_connection(source)


@mcp.tool()
def openreply_fetch_steam(query: str, limit: int = 30) -> list[dict]:
    """Steam reviews / community signal. Keyless."""
    from ..sources.steam import fetch_steam

    return fetch_steam(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_dblp(query: str, limit: int = 30) -> list[dict]:
    """DBLP computer-science bibliography. Keyless. Academic source."""
    from ..sources.dblp import fetch_dblp

    return fetch_dblp(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_europepmc(query: str, limit: int = 30) -> list[dict]:
    """Europe PMC — biomedical literature (PubMed mirror w/ extra abstracts). Keyless."""
    from ..sources.europepmc import fetch_europepmc

    return fetch_europepmc(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_devto(query: str | None = None, tag: str | None = None, limit: int = 30) -> list[dict]:
    """DEV.to articles — tech community signal."""
    from ..sources.devto import fetch_devto

    return fetch_devto(query=query, tag=tag, limit=limit)


@mcp.tool()
def openreply_fetch_lemmy(query: str, instance: str = "lemmy.world", limit: int = 30) -> list[dict]:
    """Lemmy — federated Reddit alternative, niche communities."""
    from ..sources.lemmy import fetch_lemmy

    return fetch_lemmy(query=query, instance=instance, limit=limit)


@mcp.tool()
def openreply_fetch_mastodon(query: str, instance: str = "mastodon.social", limit: int = 30) -> list[dict]:
    """Mastodon public tag timeline."""
    from ..sources.mastodon import fetch_mastodon

    return fetch_mastodon(query=query, instance=instance, limit=limit)


@mcp.tool()
def openreply_fetch_bluesky(query: str, limit: int = 30) -> list[dict]:
    """Bluesky (AT Protocol) — public posts matching a query. Free, no key."""
    from ..sources.bluesky import fetch_bluesky
    return fetch_bluesky(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_rss(
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
def openreply_fetch_producthunt(query: str, limit: int = 30) -> list[dict]:
    """Product Hunt — recent launches matching a query. Useful for 'what
    is everyone launching in this space' + competitor scanning."""
    from ..sources.producthunt import fetch_producthunt
    return fetch_producthunt(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_trustpilot(query: str, pages: int = 3, limit: int = 90) -> list[dict]:
    """Trustpilot — user reviews for a brand. `query` = brand or search term
    (we resolve it to a Trustpilot domain). Useful for product-mode sweeps."""
    from ..sources.trustpilot import fetch_trustpilot
    return fetch_trustpilot(query=query, pages=pages, limit=limit)


@mcp.tool()
def openreply_fetch_alternativeto(product: str, limit: int = 30) -> list[dict]:
    """AlternativeTo — 'what else is out there like X?' Returns competitor
    products with brief descriptions. Input is a product name (e.g. 'Notion')."""
    from ..sources.alternativeto import fetch_alternativeto
    return fetch_alternativeto(product=product, limit=limit)


@mcp.tool()
def openreply_fetch_youtube(query: str, videos: int = 5, comments_per_video: int = 50) -> list[dict]:
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
def openreply_fetch_discourse(query: str, instance: str, limit: int = 30) -> list[dict]:
    """Search a Discourse forum. `instance` is the forum domain (e.g. forum.obsidian.md)."""
    from ..sources.discourse import fetch_discourse

    return fetch_discourse(query=query, instance=instance, limit=limit)


@mcp.tool()
def openreply_fetch_github_repos(query: str, limit: int = 20) -> list[dict]:
    """Search GitHub repositories — find OSS competitors for a topic."""
    from ..sources.github_trending import search_github_repos

    return search_github_repos(query=query, limit=limit)


@mcp.tool()
def openreply_fetch_github_issues(query: str, limit: int = 30, state: str = "open") -> list[dict]:
    """Search GitHub issues — ranked by 👍 reactions (user pain density)."""
    from ..sources.github_issues import fetch_github_issues

    return fetch_github_issues(query=query, limit=limit, state=state)


@mcp.tool()
def openreply_fetch_wikipedia(topic: str, pageview_days: int = 90) -> dict:
    """Wikipedia summary + pageview time series — topic popularity signal."""
    from ..sources.wikipedia import fetch_wikipedia_pageviews, fetch_wikipedia_summary

    return {
        "summary": fetch_wikipedia_summary(topic),
        "pageviews": fetch_wikipedia_pageviews(topic, days=pageview_days),
    }


@mcp.tool()
def openreply_fetch_package_stats(
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


# ── Paper research pipeline ──────────────────────────────────────────────────


# ── graph analysis (NetworkX) ────────────────────────────────────────────────


@mcp.tool()
def openreply_graph_pagerank(topic: str, top_n: int = 20, kind: str | None = None) -> list[dict]:
    """Rank nodes by PageRank — surfaces hidden structural hubs.

    Optionally filter to one kind: 'painpoint', 'product', 'workaround', etc.
    """
    from ..graph.analyze import pagerank_nodes

    return pagerank_nodes(topic=topic, top_n=top_n, kind=kind)


@mcp.tool()
def openreply_graph_communities(topic: str, max_communities: int = 10) -> list[dict]:
    """Louvain community detection — clusters the graph into cohesive groups."""
    from ..graph.analyze import detect_communities

    return detect_communities(topic=topic, max_communities=max_communities)


@mcp.tool()
def openreply_graph_bridges(topic: str, top_n: int = 15) -> list[dict]:
    """Betweenness centrality — structural bridges connecting otherwise-separate clusters."""
    from ..graph.analyze import betweenness_bridges

    return betweenness_bridges(topic=topic, top_n=top_n)


@mcp.tool()
def openreply_graph_structural_summary(topic: str) -> dict:
    """High-level structural metrics (nodes, edges, density, components)."""
    from ..graph.analyze import graph_summary

    return graph_summary(topic=topic)


# ─── Palace (semantic search) tools ────────────────────────────────────────────
# Same ChromaDB + ONNX MiniLM-L6-v2 the desktop app uses (sibling of openreply.db).
# The MCP server pre-warms Palace in run() so the first call here doesn't pay
# the 2-5s cold start. Embeddings flow back into the same `<data_dir>/palace/`
# the app reads — Claude search → app sees → identical hybrid (vector + BM25)
# ranking on both sides.

@mcp.tool()
def openreply_palace_status() -> dict:
    """Is the local semantic index (ChromaDB + ONNX MiniLM-L6-v2) ready?

    Returns: {installed, ready, count, archive_bytes, expected_bytes,
    cache_dir, palace_dir}. If `ready` is False, the user needs to enable
    semantic search in the app (Settings → Semantic search → Enable).
    Use openreply_palace_warmup to trigger that from here.
    """
    from ..retrieval import palace
    s = palace.model_status()
    s.update(palace.stats())
    return s


@mcp.tool()
def openreply_palace_warmup() -> dict:
    """Download + cache the ONNX embedding model (~80 MB, one-time).

    No-op if already cached. After this the palace can answer semantic
    queries in 15-30 ms p50. Returns the final progress event.
    """
    from ..retrieval import palace
    from . import jobs as _jobs
    # warmup_model emits structured-event dicts (`{kind, ...}`), not plain
    # strings — adapt to a string for the regex-based progress logger.
    base_log = _jobs.make_progress_logger(prefix="[warmup] ")
    def _warmup_log(ev):
        try:
            kind = ev.get("kind") if isinstance(ev, dict) else None
            base_log(f"{kind or 'event'}: {ev}")
        except Exception:
            pass
    return palace.warmup_model(progress=_warmup_log)


@mcp.tool()
def openreply_semantic_search(
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
    openreply_query_db to fetch full body when needed.

    On HNSW corruption: the call auto-heals (moves the corrupt index
    aside) and queues a background reindex via the jobs table so the
    palace repopulates without blocking this call. The first response
    after a heal carries `healed=True` + a `reindex_job_id` so callers
    know the next call may have more data.
    """
    from ..retrieval import palace
    res = palace.search_posts(
        query, topic=topic, source_type=source_type, k=k, rerank=rerank,
    )
    # If the call auto-healed, kick off reindex_all in the background so
    # the empty-result window is as short as possible. Idempotent — if a
    # reindex job is already running this submission is harmless.
    if isinstance(res, dict) and res.get("healed"):
        try:
            from . import jobs as _jobs
            job = _jobs.submit("openreply_palace_reindex", {})
            res["reindex_job_id"] = job.get("job_id") if isinstance(job, dict) else None
        except Exception as e:
            res["reindex_submit_error"] = str(e)[:200]
    return res


@mcp.tool()
def openreply_related_posts(post_id: str, k: int = 10, topic: str | None = None) -> dict:
    """Find posts semantically nearest to a given post_id (vector cosine).

    Useful for "more like this" — Claude can pick a high-signal post then
    expand the search radius without thinking up new keywords. Filters
    by topic if provided.
    """
    from ..retrieval import palace
    return palace.related_posts(post_id, k=k, topic=topic)


@mcp.tool()
def openreply_graph_invariants(topic: str) -> dict:
    """Run structural invariant checks on a topic's knowledge graph.

    Checks four invariants — required_fields, root_present, acyclic,
    no_orphans — and records every result to the checks_ledger so the
    Provenance & Audit panel can surface them.

    Args:
        topic: the topic slug whose graph_nodes/graph_edges to inspect.

    Returns:
        ``{"ok": bool, "checks": [{"invariant": str, "passed": bool,
        "detail": str}, ...]}``.  Always returns a dict, never raises.
    """
    from ..graph.invariants import check_graph_invariants
    return check_graph_invariants(topic)


@mcp.tool()
def openreply_diagnostics() -> dict:
    """Single-call health probe across every subsystem the other MCP
    tools depend on. Use FIRST when a tool fails — the response tells
    you whether it's a DB issue, palace corruption, missing LLM key,
    or empty corpus, and which fix tool to call next.

    Returns: ``{ok, db, palace, llm, corpus, suggestions: [str, ...]}``.
    Each section is its own dict with `ok` + `detail` so you can see at
    a glance which subsystem is wedged.

    Example response when palace is corrupt:
    ```
    {
      "ok": false,
      "db": {"ok": true, "tables": 47, "wal_pages": 0},
      "palace": {"ok": false, "ready": false, "count": 0,
                 "detail": "HNSW segment writer corrupt"},
      "llm": {"ok": true, "provider": "anthropic"},
      "corpus": {"ok": true, "topics": 6, "posts": 4221},
      "suggestions": ["Call openreply_palace_repair(also_reindex=True)"]
    }
    ```
    """
    out: dict = {"ok": True, "suggestions": []}

    # ── DB
    try:
        from ..core.db import get_db
        db = get_db()
        tables = list(db.table_names())
        wal = db.conn.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchone()
        wal_pages = (wal or [0, 0, 0])[1] if wal else 0
        out["db"] = {"ok": True, "tables": len(tables), "wal_pages": wal_pages}
    except Exception as e:
        out["ok"] = False
        out["db"] = {"ok": False, "detail": str(e)[:200]}
        out["suggestions"].append(
            "DB error — restart the sidecar; "
            "boot triggers the WAL self-heal automatically."
        )

    # ── Palace
    try:
        from ..retrieval import palace
        if not palace.is_available():
            out["palace"] = {"ok": False, "ready": False,
                             "detail": "chromadb not installed"}
            out["suggestions"].append(
                "Install retrieval extras: `pip install -e '.[retrieval]'`"
            )
        else:
            status = palace.model_status()
            stats = palace.stats()
            ready = bool(status.get("ready"))
            count = int(stats.get("count") or 0)
            # Probe with an empty query — if it raises, the index is corrupt.
            probe_err = None
            try:
                palace.search_posts("__diag_probe__", k=1)
            except Exception as pe:
                probe_err = str(pe)[:200]
            out["palace"] = {
                "ok": ready and probe_err is None,
                "ready": ready,
                "count": count,
                "probe_error": probe_err,
            }
            if probe_err and palace._looks_like_hnsw_corruption(Exception(probe_err)):
                out["ok"] = False
                out["suggestions"].append(
                    "Call openreply_palace_repair(also_reindex=True) to "
                    "rebuild the corrupt vector index."
                )
            elif not ready:
                out["suggestions"].append(
                    "Palace not warmed up — call openreply_palace_warmup."
                )
            elif count == 0:
                out["suggestions"].append(
                    "Palace empty — call openreply_palace_reindex (or "
                    "submit as a job: openreply_jobs_submit('openreply_palace_reindex'))."
                )
    except Exception as e:
        out["palace"] = {"ok": False, "detail": str(e)[:200]}

    # ── LLM provider chain
    try:
        from ..analyze.providers.base import resolve_provider
        try:
            prov = resolve_provider(None)
            out["llm"] = {"ok": True, "provider": prov}
        except RuntimeError as e:
            out["ok"] = False
            out["llm"] = {"ok": False, "detail": str(e)[:200]}
            out["suggestions"].append(
                "No LLM provider configured — set ANTHROPIC_API_KEY / "
                "OPENAI_API_KEY (or another provider key) and restart."
            )
    except Exception as e:
        out["llm"] = {"ok": False, "detail": f"resolve failed: {e!s:.200}"}

    # ── Corpus shape
    try:
        from ..core.db import get_db
        db = get_db()
        posts = db.execute("SELECT count(*) FROM posts").fetchone()[0]
        topics = (
            db.execute("SELECT count(DISTINCT topic) FROM topic_posts").fetchone()[0]
            if "topic_posts" in db.table_names() else 0
        )
        out["corpus"] = {"ok": True, "topics": topics, "posts": posts}
        if posts == 0:
            out["suggestions"].append(
                "No posts collected — run openreply_collect first."
            )
    except Exception as e:
        out["corpus"] = {"ok": False, "detail": str(e)[:200]}

    if not out["suggestions"]:
        out["suggestions"].append("All subsystems healthy.")
    return out


@mcp.tool()
def openreply_palace_repair(also_reindex: bool = False) -> dict:
    """Heal a corrupt palace (HNSW segment writer / 'failed to apply logs'
    / 'invalid argument: hnsw') by moving the on-disk index aside so the
    next `openreply_semantic_search` call rebuilds a fresh, empty store.

    Use when `openreply_semantic_search` returns errors mentioning the HNSW
    segment writer, or after a hard kill that left the palace half-written.
    Safe — the corpus stays in `posts` / `topic_posts`; only the derived
    vector index is moved.

    Args:
        also_reindex: if True, kick off `reindex_all()` synchronously
                      after healing (slow — minutes for 20k posts).
                      Otherwise the index repopulates incrementally on
                      future upserts. Prefer False + a separate
                      `openreply_jobs_submit("openreply_palace_reindex", {})`.

    Returns: ``{ok, healed, backup_path?, reason?, reindex?}``.
    """
    from ..retrieval import palace
    res = palace.heal_corrupt_index()
    if also_reindex and res.get("healed"):
        try:
            from . import jobs as _jobs
            res["reindex"] = palace.reindex_all(
                progress=_jobs.make_progress_logger(prefix="[repair-reindex] "),
            )
        except Exception as e:
            res["reindex_error"] = str(e)[:200]
    return res


@mcp.tool()
def openreply_palace_reindex() -> dict:
    """Re-embed every row in `posts` into the palace. Idempotent (~2K posts/min).

    Use after a bulk fetch when the model wasn't ready at upsert time, or
    after changing what fields go into the embedding text. Safe to interrupt;
    next run picks up where it left off because Chroma upserts by id.

    Long-running: prefer `openreply_jobs_submit("openreply_palace_reindex", {})`
    so you can poll status with `openreply_jobs_get(job_id)` instead of
    holding the MCP transport open for minutes.
    """
    from ..retrieval import palace
    from . import jobs as _jobs
    return palace.reindex_all(
        progress=_jobs.make_progress_logger(prefix="[reindex] "),
    )


# ─── Async job queue (2026-05-01) ─────────────────────────────────────
# Pattern B from the long-call redesign: any tool can be fired
# asynchronously via `openreply_jobs_submit`, which returns a job_id in
# milliseconds. Work runs in a 4-thread pool inside this daemon; agents
# poll `openreply_jobs_get` whenever they want. Survives Cursor cycling,
# chat resets, and (via SQLite persistence) daemon restarts.
@mcp.tool()
def openreply_jobs_submit(tool_name: str, args: dict | None = None) -> dict:
    """Queue any registered tool for async execution.

    Returns immediately with `{ok, job_id, state}`. The work runs in a
    background thread inside this daemon — your client connection is
    free to do other tool calls or even disconnect. Poll the result
    with `openreply_jobs_get(job_id)`.

    Args:
        tool_name: any registered MCP tool name, e.g. 'openreply_collect'.
        args: kwargs forwarded to the tool. Pass {} for no-arg tools.

    Use this for anything that runs >5s — `openreply_collect` on
    a big topic, `openreply_palace_reindex`,
    `openreply_graph_build_relations`, anything LLM-heavy. Sub-5s tools
    don't benefit from queueing — call them synchronously.

    Cancellation: `openreply_jobs_cancel(job_id)` sets a flag that
    cooperative tools observe; non-cooperative tools run to completion
    but their result is marked `cancelled` instead of `done`.
    """
    from . import jobs
    return jobs.submit(tool_name, args or {}, _TOOL_REGISTRY)


@mcp.tool()
def openreply_jobs_get(job_id: str) -> dict:
    """Inspect a single job. Returns state, progress, and result-when-done.

    States: queued | running | done | failed | cancelled | interrupted.
    `interrupted` means the daemon restarted while the job was running
    or queued — re-submit if needed.

    When state is `done` or `cancelled` and the result fits under the
    1 MB cap, the inflated result is included as `result`. If the
    result was too large, `result_truncated=1` and a head preview is
    in `result_json` — re-run the underlying tool with paging.
    """
    from . import jobs
    return jobs.get(job_id)


@mcp.tool()
def openreply_jobs_list(
    state: str | None = None,
    tool_name: str | None = None,
    limit: int = 50,
) -> dict:
    """List recent jobs newest-first.

    Args:
        state: filter — queued | running | done | failed | cancelled | interrupted.
        tool_name: filter to one tool (e.g. all `openreply_collect` runs).
        limit: max rows (clamped 1..500, default 50).

    Use without args to see "what's in flight right now". Use
    `state='running'` to confirm a long job is still alive.
    """
    from . import jobs
    return jobs.list_jobs(state=state, tool_name=tool_name, limit=limit)


@mcp.tool()
def openreply_jobs_cancel(job_id: str) -> dict:
    """Request cancellation of a queued or running job.

    Queued jobs flip to `cancelled` immediately. Running jobs depend on
    the underlying tool: if it polls `is_cancelled()`, it stops at the
    next checkpoint; otherwise it runs to completion but the row's
    final state will be `cancelled` rather than `done`.
    """
    from . import jobs
    return jobs.cancel(job_id)


# ─── 2026-04-21 Tier-1..6 build — MCP surface for new features ────────
# Exposes every feature we shipped across AG-B..F + FG so external MCP
# clients (Claude Code, Cursor, Claude Desktop) can drive the full app
# programmatically, not just via the desktop UI.

@mcp.tool()
def openreply_topic_soft_delete(topic: str) -> dict:
    """T1.3 — Soft-delete a topic. Hidden from list_topics; recoverable
    for 7 days via `openreply_topic_restore`. Returns
    `{ok, topic, deleted_at, recoverable_until, hidden_posts,
    hidden_graph_nodes}`."""
    from ..research.trash import soft_delete
    return soft_delete(topic)


@mcp.tool()
def openreply_topic_restore(topic: str) -> dict:
    """Restore a soft-deleted topic. Clears topic_prefs.deleted_at."""
    from ..research.trash import restore
    return restore(topic)


@mcp.tool()
def openreply_topic_trash_list() -> list[dict]:
    """List soft-deleted topics with age + post count + expires_in_days."""
    from ..research.trash import list_trash
    return list_trash()


@mcp.tool()
def openreply_topic_trash_purge(min_age_days: int = 7) -> dict:
    """Hard-delete soft-deleted topics older than N days. Default 7."""
    from ..research.trash import purge_older_than
    return purge_older_than(min_age_days=min_age_days)


@mcp.tool()
def openreply_clean_corpus(
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
def openreply_find_existing_topic(user_input: str) -> dict:
    """Pre-check before starting a collect — does a semantically-identical
    topic already exist? Returns `{match: {existing_topic, posts}}` or
    `{match: null}`."""
    from ..research.topic_resolver import find_existing_topic
    match = find_existing_topic(user_input) or {}
    return {"ok": True, "user_input": user_input, "match": match or None}


@mcp.tool()
def openreply_merge_duplicate_topics(apply: bool = False) -> dict:
    """Merge LLM-canonicalization-caused duplicate topic rows. Scoped to
    system-caused dupes only (traced via topic_canonicalizations).
    Dry-run by default."""
    from ..research.topic_resolver import merge_duplicate_topics
    return merge_duplicate_topics(dry_run=not apply)


@mcp.tool()
def openreply_collect_quality_check(topic: str) -> dict:
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
def openreply_feedback_record(
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
def openreply_feedback_list(topic: str | None = None) -> list[dict]:
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
def openreply_saved_view_create(
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
def openreply_saved_view_list(scope: str | None = None) -> list[dict]:
    """List saved views, optionally scoped."""
    from ..research.saved_views import list_views
    return list_views(scope=scope)


@mcp.tool()
def openreply_prompt_list() -> dict:
    """T3.7 — List every extractor prompt key + whether it has an override
    set + previews of bundled and override text."""
    from ..research.prompt_store import list_prompts
    return list_prompts()


@mcp.tool()
def openreply_prompt_get(key: str) -> str:
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
def openreply_prompt_set(key: str, override_text: str) -> dict:
    """Set an extractor prompt override. Empty string clears."""
    from ..research.prompt_store import set_prompt
    set_prompt(key, override_text)
    return {"ok": True, "key": key, "cleared": not override_text}


@mcp.tool()
def openreply_ingest_csv(path: str, topic: str, source_type: str = "csv") -> dict:
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

# ─── Graph densification + research linking (2026-04-20 / 04-21) ──────
@mcp.tool()
def openreply_graph_build_relations(topic: str) -> dict:
    """Run the post-pass that emits relates_to / potentially_solves /
    could_address / co_evidenced edges across findings. No LLM cost —
    uses ChromaDB MiniLM. Safe to re-run (upserts)."""
    from ..graph.relations import build_semantic_relations
    from . import jobs as _jobs
    _log = _jobs.make_progress_logger(prefix="[graph-relations] ")
    _log(f"start topic='{topic}'")
    r = build_semantic_relations(topic)
    _log(
        f"done edges={r.get('edges_added', 0) if isinstance(r, dict) else '?'}"
    )
    return r


@mcp.tool()
def openreply_link(topic: str, k: int = 3) -> dict:
    """Link each finding to top-K semantically similar academic papers
    in the corpus. Persists to finding_research_links."""
    from ..research.research_linker import link_findings_for_topic
    return link_findings_for_topic(topic=topic, k=k)


@mcp.tool()
def openreply_links(topic: str, finding: str | None = None) -> list[dict] | dict:
    """Get linked papers. finding=None → per-finding count summary;
    finding=<title> → list of linked papers with similarity + metadata."""
    from ..research.research_linker import get_links_for_finding, get_links_summary
    if finding:
        return get_links_for_finding(topic=topic, finding_title=finding)
    return get_links_summary(topic=topic)


@mcp.tool()
def openreply_search_all(
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


# ─── Stakeholder-ready exports (DOCX + PPTX) ─────────────────────────────
# Read-only over the existing corpus: same tables the markdown exporter
# uses (topic_insights + posts + topic_posts + graph_nodes). Both tools
# return a clear install hint if python-docx / python-pptx aren't on the
# host so users know exactly what to `pip install`.


@mcp.tool()
def openreply_export_docx(
    topic: str,
    out_path: str,
    extra_topics: list[str] | None = None,
    title: str | None = None,
    subtitle: str | None = None,
    max_painpoints: int = 12,
) -> dict:
    """Export a stakeholder-ready DOCX research brief for `topic`.

    Pulls painpoints, competitor teardown, voice-of-customer quotes, and
    (if available) LLM-synthesized insights into a Word document with
    cited evidence quotes for every claim. `extra_topics` widens the
    corpus by merging sibling topics (e.g. all 6 lending topics).

    Requires `python-docx` (~5 MB). If missing, returns
    `{ok: False, install_hint}` instead of raising.

    Returns: {ok, path, painpoint_count, citation_count, competitor_count, total_corpus_posts}
    """
    from ..research.export_deck import build_docx
    return build_docx(
        topic=topic,
        out_path=out_path,
        extra_topics=extra_topics,
        title=title,
        subtitle=subtitle,
        max_painpoints=max_painpoints,
    )


@mcp.tool()
def openreply_export_pptx(
    topic: str,
    out_path: str,
    extra_topics: list[str] | None = None,
    title: str | None = None,
    subtitle: str | None = None,
    max_painpoints: int = 6,
) -> dict:
    """Export a 12-15 slide PPTX pitch deck for `topic`.

    Slide order: cover · TL;DR · corpus snapshot · top market quote ·
    one slide per top painpoint with cited evidence · competitor matrix ·
    voice of the customer · top opportunities · re-pull instructions.

    Requires `python-pptx` (~5 MB). If missing, returns
    `{ok: False, install_hint}` instead of raising.

    Returns: {ok, path, slide_count, painpoint_count, competitor_count, total_corpus_posts}
    """
    from ..research.export_deck import build_pptx
    return build_pptx(
        topic=topic,
        out_path=out_path,
        extra_topics=extra_topics,
        title=title,
        subtitle=subtitle,
        max_painpoints=max_painpoints,
    )


@mcp.tool()
def openreply_export_pdf_from_markdown(
    md_path: str,
    out_path: str,
    title: str | None = None,
    subtitle: str | None = None,
    brand_link: str = "openreply.myind.ai",
    brand_link_url: str = "https://openreply.myind.ai",
) -> dict:
    """Convert a markdown research brief to a brand-styled PDF.

    Pipeline: pandoc → XeLaTeX with the bundled `header.tex` + the
    `widen-quote.lua` Lua filter (lifted from
    `docs/demo_pdf/pdf_build/`). Same brand palette (#1F4E79 accent,
    Poppins headings, DejaVu Sans body) as the DOCX exporter.

    Requires xelatex on PATH. If missing, returns
    `{ok: False, install_hint}` with the BasicTeX/MacTeX command.

    Returns: {ok, path, engine: 'xelatex', source_chars, output_bytes,
              header_tex, lua_filter}
    """
    from ..research.export_deck import build_pdf_from_markdown
    return build_pdf_from_markdown(
        md_path=md_path, out_path=out_path,
        title=title, subtitle=subtitle,
        brand_link=brand_link, brand_link_url=brand_link_url,
    )


@mcp.tool()
def openreply_export_docx_from_markdown(
    md_path: str,
    out_path: str,
    reference_docx: str | None = None,
) -> dict:
    """Convert an existing markdown research brief to DOCX with full fidelity.

    Use this when the rich research doc already exists as markdown
    (cited evidence, competitor tables, code blocks, blockquotes,
    headings) and you want a Word file that opens cleanly in Word /
    Pages / Google Docs with tables, quotes, and formatting preserved.

    Strategy:
      - Primary: pandoc via pypandoc (gold standard for md → docx;
        preserves GFM tables, blockquotes, fenced code, lists, links).
      - Fallback: lightweight python-docx renderer if pandoc is not on
        the host. Lower fidelity on edge cases but zero extra deps.

    Install pandoc (auto-bundled): `pip install pypandoc-binary`.

    Returns: {ok, path, engine ('pandoc'|'python-docx-fallback'), source_chars, output_bytes}
    """
    from ..research.export_deck import build_docx_from_markdown
    return build_docx_from_markdown(
        md_path=md_path, out_path=out_path, reference_docx=reference_docx,
    )


# ─── PERT estimation (three-point) ──────────────────────────────────────────
# Wraps research/pert.py so headless agents can build + roll up a PERT
# estimate. E = (O + 4M + P) / 6, SD = (P - O) / 6; rollup applies a
# McConnell overhead multiplier across a tier's tasks.

# ─── Idea scan (fast 2-word discovery) ──────────────────────────────────────
# Wraps research/idea_scan.py — a fast fan-out across enabled sources that
# halts at a corpus threshold, then clusters. start is potentially long, so
# it runs under the timeout guard with the jobs-queue fallback recommendation.

@mcp.tool()
def openreply_connections(topic: str, compute: bool = False) -> dict:
    """Connect the dots — novel cross-paper connections the literature hasn't made.

    Surfaces understudied intersections, contradictions, under-replicated methods,
    and shared-but-uncited parallel findings across a topic's academic papers,
    ranked by a novelty score. compute=False reads the cached artifact;
    compute=True (re)builds from paper-gaps + the paper relation graph (runs an
    LLM 'why is this new' pass under the timeout guard).
    """
    from ..research.connections import connections_get, connections_compute
    if compute:
        return _run_with_timeout(
            connections_compute, timeout=90.0,
            async_hint="openreply_connections", kwargs={"topic": topic})
    return connections_get(topic)


# ─── Production guards — prevents the "18 zombie MCP servers" bug ───
# Shipping lessons from 2026-04-21 — a user session accumulated 18
# `openreply mcp serve` processes over 2 days (Claude Code / Cursor
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

    Per-client scoping via `MCP_CLIENT_TAG` env var. Without it, every
    configured MCP client (Claude Code, Claude Desktop, Cursor, …) shares
    one lock file — and because each install bakes in `MCP_TAKEOVER_STALE_LOCK=1`,
    every reconnect from any client kills the live server owned by another
    client. Net effect: cross-client thrash, zero clean shutdowns,
    "lost connection" errors mid-tool-call.

    With `MCP_CLIENT_TAG=claude-code`, the lock becomes
    `mcp-server.claude-code.pid` — Cursor uses its own
    `mcp-server.cursor.pid`, and they never fight. `install.py` writes
    the tag into each entry's env automatically.

    Fallback: if the env var is missing (entries written before this
    change), use the original `mcp-server.pid` path so re-sync isn't
    forced.
    """
    import os
    import re
    from pathlib import Path
    try:
        from ..core.config import _resolve_data_dir
        base = _resolve_data_dir()
    except Exception:
        base = Path.home() / ".openreply"
        base.mkdir(parents=True, exist_ok=True)
    tag = (os.environ.get("MCP_CLIENT_TAG") or "").strip().lower()
    # Sanitise — only allow `[a-z0-9-]` so a malformed tag can't escape
    # the data dir or produce weird filenames.
    tag = re.sub(r"[^a-z0-9-]", "", tag)
    if tag:
        return base / f"mcp-server.{tag}.pid"
    return base / "mcp-server.pid"


def _is_alive(pid: int) -> bool:
    """True only if PID is a *live* process.

    ``os.kill(pid, 0)`` succeeds for a zombie/defunct process too — but a
    zombie holds no resources and serves nothing, so a lock it appears to
    "hold" must be reclaimable. We exclude zombies via the process state
    (``ps ... -o state=`` → leading ``Z``). Without this, a crashed MCP
    server the client hasn't reaped yet permanently blocks startup with
    ``another_mcp_server_running`` — SIGTERM/SIGKILL cannot touch a zombie,
    so takeover gives up. Best-effort: a ``ps`` failure (e.g. Windows, where
    zombies don't exist anyway) falls back to the kill-0 result.
    """
    import os
    import subprocess
    try:
        os.kill(pid, 0)
    except (OSError, ProcessLookupError):
        return False
    try:
        state = subprocess.run(
            ["ps", "-p", str(pid), "-o", "state="],
            capture_output=True, text=True, timeout=2,
        ).stdout.strip()
        if state[:1] == "Z":
            return False
    except Exception:
        pass
    return True


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
    """Kill `openreply mcp serve` processes older than `max_age_days`
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
            if "openreply" not in cmd or "mcp" not in cmd or "serve" not in cmd:
                continue
            if (p.info.get("create_time") or 0) > cutoff:
                continue  # too young — might be legit parallel session
            p.terminate()
            killed += 1
        except Exception:
            continue
    return killed


# Module-level activity tracker — shared between the tool wrapper (which
# bumps it on every tool call) and the idle-timeout watcher (which reads
# it). Single-element list so closures can mutate without `nonlocal`.
_LAST_ACTIVITY_TS: list[float] = [0.0]


def _bump_activity() -> None:
    """Mark the server as active. Called from the tool-call wrapper on
    every JSON-RPC tool dispatch so the idle-timeout watcher knows the
    session is still in use, regardless of how FastMCP reads stdin."""
    import time
    _LAST_ACTIVITY_TS[0] = time.time()


def _clean_shutdown_then_exit(*, reason: str, **details: Any) -> None:
    """Release the pidfile, log a `startup:exit` event, then call
    ``os._exit(0)``.

    Why not ``sys.exit(0)``: this runs from a daemon watcher thread, and
    ``sys.exit`` only raises ``SystemExit`` on the calling thread — it
    won't terminate the main thread blocked in FastMCP's stdio read.
    ``os._exit`` does kill the whole process, but skips ``atexit`` —
    so we run the cleanup we need (pidfile release + log) by hand first.
    """
    import os
    import time
    try:
        from .logger import log_event as _log
        _log(
            "startup:exit",
            message=f"shutdown: {reason}",
            details={"shutdown_reason": reason, **details},
        )
    except Exception:
        pass
    try:
        _release_pidfile_lock()
    except Exception:
        pass
    # Best-effort flush of stderr before the kernel reaps us.
    try:
        import sys as _s
        _s.stderr.flush()
    except Exception:
        pass
    os._exit(0)


def _install_signal_handlers() -> None:
    """Catch SIGTERM (and SIGHUP on Unix) so the takeover path — where a
    new client spawn SIGTERMs the prior server — runs the same clean
    shutdown sequence as the idle-timeout watcher.

    The default SIGTERM handler raises ``SystemExit``, which *should*
    trigger ``atexit`` and hence ``startup:exit``. In practice FastMCP's
    anyio event loop sometimes swallows the exception, so we get killed
    without ``startup:exit`` being recorded and the pidfile leaks. An
    explicit handler bypasses the asyncio path entirely.
    """
    import signal
    import sys

    def _handler(signum, _frame):  # noqa: ARG001
        name = signal.Signals(signum).name if hasattr(signal, "Signals") else str(signum)
        _clean_shutdown_then_exit(reason=f"signal:{name.lower()}")

    for sig in ("SIGTERM", "SIGHUP", "SIGINT"):
        s = getattr(signal, sig, None)
        if s is None:
            continue
        try:
            signal.signal(s, _handler)
        except (ValueError, OSError):
            # Not the main thread, or signal not supported on this OS.
            # Best-effort — skip silently rather than crash startup.
            pass

    # Windows has no SIGHUP; SIGINT is handled the same as Unix.
    _ = sys


def _start_idle_timeout_guard(timeout_seconds: int) -> None:
    """Background daemon thread — clean-shutdown if the server has been
    idle for `timeout_seconds`, OR if the parent process died (orphan
    case where launchd/init has adopted us).

    Activity is tracked via tool-call entries in `_LAST_ACTIVITY_TS`,
    NOT via `sys.stdin.readline` — FastMCP wraps `sys.stdin.buffer`
    in its own `TextIOWrapper` and reads from that, so a monkey-patch
    on the original `sys.stdin.readline` would never fire and the
    watcher would kill the server every `timeout_seconds` regardless
    of activity (the bug that produced 36 startups / 3 clean exits per
    day before this fix).

    Orphan detection (`os.getppid() == 1`) handles the case where
    Claude Code / Cursor crashes and leaves the MCP child running
    forever, re-parented to launchd. fastmcp doesn't always notice
    its stdin pipe has nothing on the other end, so without this
    check the orphan accumulates indefinitely.
    """
    import os
    import sys
    import threading
    import time

    _LAST_ACTIVITY_TS[0] = time.time()  # initialise at startup

    def _watcher():
        # Sleep in 60-second slices. We don't need fine-grained timing —
        # idle timeout is on the order of minutes/hours.
        while True:
            time.sleep(60)
            # 1. Orphan check — parent died, we're talking to nobody.
            try:
                if os.getppid() == 1:
                    sys.stderr.write(
                        "[mcp] orphaned (parent=launchd/init); shutting down\n"
                    )
                    sys.stderr.flush()
                    _clean_shutdown_then_exit(reason="orphaned_parent")
                    return
            except Exception:
                pass  # getppid is essentially infallible; defensive only

            # 2. Idle check — no tool calls in `timeout_seconds`.
            if time.time() - _LAST_ACTIVITY_TS[0] > timeout_seconds:
                sys.stderr.write(
                    f"[mcp] idle-timeout: no tool activity for {timeout_seconds}s; "
                    f"exiting to prevent zombie accumulation\n"
                )
                sys.stderr.flush()
                _clean_shutdown_then_exit(
                    reason="idle_timeout",
                    idle_seconds=timeout_seconds,
                )
                return

    t = threading.Thread(target=_watcher, daemon=True, name="mcp-idle-watcher")
    t.start()


# ── Sub-server composition ────────────────────────────────────────────────
# Mount focused sub-servers without a namespace prefix so tool names stay
# consistent with the `openreply_*` convention. New domains get their own
# sub-server file under mcp/tools/ and a mount() call here.
try:
    from .tools.persona_tools import persona_server as _persona_server
    mcp.mount(_persona_server)
except Exception as _e:  # pragma: no cover
    import warnings
    warnings.warn(f"persona_tools sub-server failed to mount: {_e}", stacklevel=1)


def run(
    transport: str = "stdio",
    host: str = "127.0.0.1",
    port: int = 8765,
) -> None:
    """Start the server.

    Args:
        transport: 'stdio' (default, for Claude Code / Desktop / Cursor stdio)
            or 'http' / 'streamable-http' / 'sse' for daemon-style HTTP.
            HTTP mode is recommended for Cursor — its stdio MCP client
            cycles servers every ~5 min, killing in-flight long calls.
        host: bind host for HTTP transport. Default 127.0.0.1.
        port: bind port for HTTP transport. Default 8765.

    Hardened (2026-04-21) against zombie accumulation — see Production
    guards block above for the three-layer defense.

    Startup-time optimisations:

    1. Pre-warm Palace (lazy-init the ChromaDB client + collection handle).
       Costs ~50ms but means the first `openreply_semantic_search` call doesn't
       eat the cold-start. We DON'T eagerly run an embedding here — that's
       a 2-5s ONNX compile and most MCP sessions never touch semantic.
       Set OPENREPLY_PALACE_EAGER=1 to force the embed-warm too.

    2. Read OPENREPLY_TOKEN env var (provisioning marker — plumbed for v2
       enforcement, no-op today).

    3. Tunable idle-timeout via OPENREPLY_IDLE_TIMEOUT (seconds, default
       1800 = 30 min). Set to 0 to disable.

    4. Tunable stale-sibling sweep via OPENREPLY_SWEEP_STALE_DAYS
       (default 1). Set to 0 to disable.
    """
    import atexit
    import os
    import sys
    import time

    # Structured logger — file + SQLite event store. Calls are best-effort;
    # a broken logger never crashes the server. Install the unhandled-
    # exception hook FIRST so an import error in the legacy server module
    # below still gets recorded as `fatal:unhandled` in mcp_events.
    from .logger import (
        log_event as _log_event,
        install_unhandled_exception_hook,
    )
    install_unhandled_exception_hook()
    _startup_t0 = time.time()
    _log_event(
        "startup:begin",
        message=f"mcp serve invoked, pid={os.getpid()}",
        details={
            "argv": sys.argv,
            "python": sys.executable,
            "env_takeover": os.environ.get("MCP_TAKEOVER_STALE_LOCK", ""),
            "env_data_dir": os.environ.get("OPENREPLY_DATA_DIR", ""),
            "env_idle_timeout": os.environ.get("OPENREPLY_IDLE_TIMEOUT", ""),
        },
    )

    _ = os.environ.get("OPENREPLY_TOKEN", "")

    # Guard 1 — PID-file lock. If another live instance owns the lock,
    # exit with a clear diagnostic rather than racing. When MCP was
    # installed by the desktop app, MCP_TAKEOVER_STALE_LOCK=1 is set
    # in the client config so a restart automatically reclaims the
    # lock from a zombie prior instance.
    if not _acquire_pidfile_lock():
        import json
        msg = "another_mcp_server_running"
        hint = ("Another MCP server instance is still alive. "
                f"Kill it or remove {_pidfile_path()} if you're sure "
                "it's dead. To let the server auto-reclaim a stale "
                "lock on restart, set MCP_TAKEOVER_STALE_LOCK=1 in "
                "your MCP client's env (or re-run `mcp install` from "
                "the desktop app, which wires this automatically).")
        # Record as `error` (not `fatal`) — the server didn't crash, it
        # politely refused to start. The next reconnect with takeover=1
        # turns this into `startup:lock_takeover` instead.
        _log_event(
            "startup:lock_failed", severity="error", message=msg,
            details={"hint": hint, "pidfile": str(_pidfile_path())},
        )
        sys.stderr.write(json.dumps({"error": msg, "hint": hint}) + "\n")
        sys.stderr.flush()
        raise SystemExit(2)
    _log_event("startup:lock_acquired", message=f"pid file locked at {_pidfile_path()}")
    atexit.register(_release_pidfile_lock)
    atexit.register(lambda: _log_event(
        "startup:exit",
        message="mcp serve atexit fired (clean shutdown)",
        details={"uptime_sec": round(time.time() - _startup_t0, 1)},
    ))

    # Catch SIGTERM/SIGHUP/SIGINT explicitly so the takeover path (where
    # a fresh client spawn evicts us with SIGTERM) runs the same clean
    # cleanup as a normal shutdown — pidfile released, `startup:exit`
    # logged. Without this, FastMCP's anyio loop sometimes swallows the
    # SystemExit and the pidfile leaks pointing at a dead PID.
    _install_signal_handlers()

    # Guard 3 — sweep stale siblings. Non-blocking; swallows all errors.
    try:
        sweep_days = int(os.environ.get("OPENREPLY_SWEEP_STALE_DAYS", "1"))
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
    # (which already owns process lifecycle), when disabled via env, or
    # when running in HTTP/daemon mode (clients connect/disconnect freely
    # so "no recent tool call" is normal, not a zombie signal).
    try:
        idle_seconds = int(os.environ.get("OPENREPLY_IDLE_TIMEOUT", "1800"))
    except ValueError:
        idle_seconds = 1800
    if (
        idle_seconds > 0
        and os.environ.get("OPENREPLY_NO_IDLE_GUARD") != "1"
        and transport == "stdio"
    ):
        _start_idle_timeout_guard(idle_seconds)

    # Lazy palace client init — opens the SQLite-backed Chroma store but does
    # NOT load the ONNX model yet. Worst case: chromadb extras missing →
    # silent skip, semantic tools return graceful "not installed" responses.
    try:
        from ..retrieval import palace
        palace.get_palace()  # opens persistent client, ~50ms
        if os.environ.get("OPENREPLY_PALACE_EAGER") in ("1", "true", "yes"):
            if palace.is_model_ready():
                # One throwaway embed → ONNX session compiled + cached for
                # the lifetime of this process. Subsequent semantic calls
                # are pure vector lookups (~15-30 ms p50).
                palace.search_posts("warmup probe", k=1)
    except Exception:
        pass

    # Job queue — recover any rows the previous daemon left in a
    # `running` or `queued` state. Without this, agents would see
    # forever-running jobs after a crash. Best-effort; failures here
    # are non-fatal.
    try:
        from . import jobs as _jobs
        recover = _jobs.recover_stale()
        if recover.get("interrupted_running") or recover.get("interrupted_queued"):
            _log_event(
                "jobs:recovered_stale",
                message="reaped stale jobs from prior daemon",
                details=recover,
            )
        # Register clean shutdown so in-flight workers don't get an abrupt
        # SIGKILL during normal exit. They'll finish naturally; any that
        # don't finish before process death will be marked interrupted on
        # next startup.
        atexit.register(_jobs.shutdown)
    except Exception:
        pass

    _log_event(
        "startup:ready",
        message=f"entering mcp.run() — transport={transport}",
        details={
            "startup_ms": int((time.time() - _startup_t0) * 1000),
            "transport": transport,
            "host": host if transport != "stdio" else None,
            "port": port if transport != "stdio" else None,
        },
    )
    try:
        if transport == "stdio":
            mcp.run()
        else:
            # FastMCP 3.x accepts host/port as transport_kwargs.
            mcp.run(transport=transport, host=host, port=port)
    except SystemExit:
        # Normal shutdown path — atexit hook records `startup:exit`.
        raise
    except BaseException as e:
        _log_event(
            "fatal:run_loop",
            severity="fatal",
            message=f"mcp.run() raised {type(e).__name__}: {e}",
            details={"uptime_sec": round(time.time() - _startup_t0, 1)},
        )
        raise
