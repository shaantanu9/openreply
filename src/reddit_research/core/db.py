"""SQLite schema + upsert helpers via sqlite-utils.

Tables mirror Reddit's model; every row has `fetched_at` so we can
track freshness without losing history.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from sqlite_utils import Database

from .config import load_config


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# Per-thread Database instance. sqlite3 connections are NOT safe to share
# across threads — they raise "SQLite objects created in a thread can only be
# used in that same thread". When the collect pipeline fans out source
# fetches in parallel, each worker needs its own connection. WAL mode (set
# below) lets multiple writers append concurrently without "database is
# locked". Schema init runs exactly once globally, guarded by a lock.
_tls = threading.local()
_schema_lock = threading.Lock()
_schema_inited = False


def get_db() -> Database:
    global _schema_inited
    db = getattr(_tls, "db", None)
    if db is None:
        cfg = load_config()
        db = Database(cfg.db_path)
        # WAL: concurrent readers never block; concurrent writers serialize
        # briefly on a filesystem-level lock (5s busy-timeout absorbs rare
        # collisions). Set per-connection so the very first call in each
        # thread flips the pragma.
        db.conn.execute("PRAGMA journal_mode=WAL")
        db.conn.execute("PRAGMA busy_timeout=5000")
        _tls.db = db
    with _schema_lock:
        if not _schema_inited:
            init_schema(db)
            _schema_inited = True
    return db


def _cache_clear() -> None:
    """Drop the per-thread DB handle and schema flag.

    Tests used to call `get_db.cache_clear()` on the old `@lru_cache` version.
    This keeps that contract working after the thread-local rewrite so tests
    can force a re-read of env-configured db_path (e.g. when monkeypatching
    REDDIT_MYIND_DATA_DIR per test).
    """
    global _schema_inited
    if hasattr(_tls, "db"):
        try:
            _tls.db.close()
        except Exception:
            pass
        del _tls.db
    _schema_inited = False


# Back-compat so existing test code calling `get_db.cache_clear()` keeps working.
get_db.cache_clear = _cache_clear  # type: ignore[attr-defined]


def init_schema(db: Database) -> None:
    """Idempotent schema creation + additive migrations."""
    if "posts" not in db.table_names():
        db["posts"].create(
            {
                "id": str,
                "sub": str,
                "source_type": str,
                "author": str,
                "title": str,
                "selftext": str,
                "url": str,
                "score": int,
                "upvote_ratio": float,
                "num_comments": int,
                "created_utc": float,
                "is_self": int,
                "over_18": int,
                "flair": str,
                "permalink": str,
                "fetched_at": str,
            },
            pk="id",
        )
        db["posts"].create_index(["sub"])
        db["posts"].create_index(["source_type"])
        db["posts"].create_index(["created_utc"])
        db["posts"].create_index(["author"])
    else:
        # Additive migration: add source_type column if missing
        cols = {c.name for c in db["posts"].columns}
        if "source_type" not in cols:
            db["posts"].add_column("source_type", str)
            db.execute("UPDATE posts SET source_type='reddit' WHERE source_type IS NULL")
            db["posts"].create_index(["source_type"], if_not_exists=True)

    if "trend_series" not in db.table_names():
        # Google Trends data — separate table, not graph nodes (time series)
        db["trend_series"].create(
            {
                "id": int,
                "topic": str,
                "keyword": str,
                "timeframe": str,
                "geo": str,
                "point_ts": str,      # ISO date
                "interest": int,      # 0–100
                "fetched_at": str,
            },
            pk="id",
        )
        db["trend_series"].create_index(["topic", "keyword"])

    if "comments" not in db.table_names():
        db["comments"].create(
            {
                "id": str,
                "post_id": str,
                "parent_id": str,
                "author": str,
                "body": str,
                "score": int,
                "created_utc": float,
                "depth": int,
                "fetched_at": str,
            },
            pk="id",
        )
        db["comments"].create_index(["post_id"])
        db["comments"].create_index(["author"])

    if "users" not in db.table_names():
        db["users"].create(
            {
                "name": str,
                "link_karma": int,
                "comment_karma": int,
                "created_utc": float,
                "is_mod": int,
                "fetched_at": str,
            },
            pk="name",
        )

    if "subreddits" not in db.table_names():
        db["subreddits"].create(
            {
                "name": str,
                "subscribers": int,
                "description": str,
                "fetched_at": str,
            },
            pk="name",
        )

    if "fetches" not in db.table_names():
        db["fetches"].create(
            {
                "id": int,
                "kind": str,
                "params_json": str,
                "started_at": str,
                "ended_at": str,
                "rows": int,
                "error": str,
            },
            pk="id",
        )

    if "streams" not in db.table_names():
        db["streams"].create(
            {
                "id": int,
                "name": str,
                "sub": str,
                "keywords": str,
                "started_at": str,
                "active": int,
            },
            pk="id",
        )
        db["stream_hits"].create(
            {
                "stream_id": int,
                "item_type": str,
                "item_id": str,
                "matched_at": str,
                "keywords_matched": str,
            },
            pk=("stream_id", "item_type", "item_id"),
        )

    # topic_posts: per-topic tag linking posts to research topics.
    # Created here so the dashboard's "topics" query doesn't error on first run.
    if "topic_posts" not in db.table_names():
        db["topic_posts"].create(
            {
                "topic": str,
                "post_id": str,
                "source": str,
                "added_at": str,
            },
            pk=("topic", "post_id"),
        )
        db["topic_posts"].create_index(["topic"])
        db["topic_posts"].create_index(["post_id"])

    # Migration: an earlier revision of this file created the graph tables
    # with `meta_json` instead of `metadata_json` and, for graph_edges, with
    # no `topic` column at all. Reconcile in place so we don't need to drop
    # user data.
    for _gt in ("graph_nodes", "graph_edges"):
        if _gt in db.table_names():
            _cols = {c.name for c in db[_gt].columns}
            if "meta_json" in _cols and "metadata_json" not in _cols:
                db.execute(
                    f"ALTER TABLE {_gt} RENAME COLUMN meta_json TO metadata_json"
                )
            if "topic" not in _cols:
                db.execute(f"ALTER TABLE {_gt} ADD COLUMN topic TEXT")
                db[_gt].create_index(["topic"], if_not_exists=True)

    # graph_nodes / graph_edges: populated later by `research graph build`
    # but pre-created so the dashboard can COUNT(*) without a missing-table error.
    # Schema MUST match graph/schema.py::ensure_graph_schema — that module still
    # runs during build and will skip creation if the table already exists.
    if "graph_nodes" not in db.table_names():
        db["graph_nodes"].create(
            {
                "id": str,
                "topic": str,
                "kind": str,
                "label": str,
                "metadata_json": str,
                "ts": str,              # ISO UTC — set on first insert,
                                        # preserved on update (see _upsert_node)
            },
            pk="id",
        )
        db["graph_nodes"].create_index(["topic"])
        db["graph_nodes"].create_index(["kind"])
        db["graph_nodes"].create_index(["topic", "kind"])
    else:
        # Lazy migration for pre-2026-04-19 installs. Existing rows get an
        # empty ts → they bucket as "stable" in diff_findings, which is
        # correct (we have no creation timestamp so treat as baseline).
        _cols = {c.name for c in db["graph_nodes"].columns}
        if "ts" not in _cols:
            db.executescript("ALTER TABLE graph_nodes ADD COLUMN ts TEXT DEFAULT ''")

    if "graph_edges" not in db.table_names():
        db["graph_edges"].create(
            {
                "src": str,
                "dst": str,
                "kind": str,
                "topic": str,
                "weight": float,
                "metadata_json": str,
            },
            pk=("src", "dst", "kind"),
        )
        db["graph_edges"].create_index(["topic"])
        db["graph_edges"].create_index(["src"])
        db["graph_edges"].create_index(["dst"])
        db["graph_edges"].create_index(["kind"])

    if "topic_canonicalizations" not in db.table_names():
        db["topic_canonicalizations"].create(
            {
                "original": str,
                "canonical": str,
                "variants_json": str,     # json.dumps of list[str]
                "confidence": str,        # 'high' | 'low' | 'unknown'
                "ts": str,                # ISO UTC
                "keywords_json": str,     # json.dumps of list[{keyword, relevance}]
            },
            pk="original",
        )
    else:
        # Lazy migration for installs created before keywords_json existed.
        cols = {c.name for c in db["topic_canonicalizations"].columns}
        if "keywords_json" not in cols:
            db.executescript(
                "ALTER TABLE topic_canonicalizations ADD COLUMN keywords_json TEXT DEFAULT ''"
            )

    if "topic_prefs" not in db.table_names():
        db["topic_prefs"].create(
            {
                "topic": str,
                "scheduled": int,         # 0 or 1; if 1, include in schedule-tick
                "last_run_seen": str,     # ISO UTC, updated when user opens topic page
                "last_run_ts": str,       # ISO UTC of most recent scheduled run
            },
            pk="topic",
        )

    if "paper_analyses" not in db.table_names():
        db["paper_analyses"].create(
            {
                "post_id": str,           # posts.id — one row per academic paper
                "topic": str,              # topic context at analysis time
                "summary": str,            # 2-3 sentence TL;DR
                "relevance": str,          # 1-2 sentences: how it applies to topic
                "takeaway": str,           # 1 sentence, imperative verb
                "ts": str,                 # ISO UTC
                "provider": str,           # resolved LLM provider
                "model": str,              # LLM_MODEL env value at write
            },
            pk="post_id",
        )
        db["paper_analyses"].create_index(["topic"])

    # Zombie sweep: any fetch row with ended_at=NULL older than 10 min is a
    # crashed/killed collect that never ran its teardown. Closing these out
    # on startup prevents the UI from showing a stale "Collecting…" chip
    # (and blocks "another collect is already running" errors from firing
    # on a fresh process). 10 min is a safe floor — the longest legitimate
    # single-source fetch we've seen (aggressive appstore) tops out at ~8.
    try:
        db.conn.execute(
            "UPDATE fetches SET ended_at=?, error=COALESCE(error,'stale: auto-swept on startup') "
            "WHERE ended_at IS NULL "
            "AND datetime(started_at) < datetime('now', '-10 minutes')",
            (_utc_now(),),
        )
        db.conn.commit()
    except Exception:
        pass


# ── Fetch audit log ──────────────────────────────────────────────────────────

def log_fetch_start(kind: str, params: dict[str, Any]) -> int:
    db = get_db()
    row = db["fetches"].insert(
        {
            "kind": kind,
            "params_json": json.dumps(params, default=str),
            "started_at": _utc_now(),
            "ended_at": None,
            "rows": 0,
            "error": None,
        }
    )
    return row.last_pk  # type: ignore[no-any-return]


def log_fetch_end(fetch_id: int, rows: int, error: str | None = None) -> None:
    db = get_db()
    db["fetches"].update(
        fetch_id, {"ended_at": _utc_now(), "rows": rows, "error": error}
    )


# ── Upserts ──────────────────────────────────────────────────────────────────

def upsert_posts(rows: Iterable[dict[str, Any]]) -> int:
    rows = list(rows)
    if not rows:
        return 0
    get_db()["posts"].upsert_all(rows, pk="id")
    # Keep the semantic-search palace in sync, best-effort. Strict gates:
    #   1. GAPMAP_SKIP_PALACE=1 → always skip (CI / tests / minimal deploys)
    #   2. retrieval extras missing → skip silently
    #   3. ONNX model not cached yet → skip silently. Critical: without
    #      this gate, the FIRST collect after install triggers 6 parallel
    #      download attempts (one per source worker) for the 79 MB ONNX
    #      file — they race, corrupt each other, and dump tqdm progress
    #      bars into the collect log. The palace is opt-in — user must
    #      click Enable in Settings → Semantic search (single serialized
    #      warmup), then a Reindex backfills the existing corpus.
    if os.getenv("GAPMAP_SKIP_PALACE") in ("1", "true", "yes"):
        return len(rows)
    try:
        from ..retrieval.palace import is_available, is_model_ready, upsert_posts_many
        if is_available() and is_model_ready():
            upsert_posts_many(rows)
    except Exception:
        pass
    return len(rows)


def upsert_comments(rows: Iterable[dict[str, Any]]) -> int:
    rows = list(rows)
    if not rows:
        return 0
    get_db()["comments"].upsert_all(rows, pk="id")
    return len(rows)


def upsert_users(rows: Iterable[dict[str, Any]]) -> int:
    rows = list(rows)
    if not rows:
        return 0
    get_db()["users"].upsert_all(rows, pk="name")
    return len(rows)


def upsert_subreddit(row: dict[str, Any]) -> None:
    get_db()["subreddits"].upsert(row, pk="name")


__all__ = [
    "get_db",
    "init_schema",
    "log_fetch_start",
    "log_fetch_end",
    "upsert_posts",
    "upsert_comments",
    "upsert_users",
    "upsert_subreddit",
]
