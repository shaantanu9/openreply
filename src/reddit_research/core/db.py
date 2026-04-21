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

    # Phase 4 — Monitoring / weekly delta tracking.
    # One row per topic refresh (manual or scheduled). The `delta_json`
    # blob captures what changed vs. the previous run: findings added,
    # findings removed, opportunity-score deltas per finding, new
    # competitors, new academic_backing. Dashboard's "What's changed this
    # week" reads from here. See docs/ROADMAP.md §Phase 4.
    if "topic_runs" not in db.table_names():
        db["topic_runs"].create(
            {
                "id": int,                  # autoincrement
                "topic": str,
                "run_at": str,              # ISO UTC, when refresh started
                "ended_at": str,            # ISO UTC, when refresh completed (null = in-flight)
                "trigger": str,             # 'manual' | 'scheduled' | 'post-collect'
                "corpus_size": int,         # posts considered at synth time
                "findings_count": int,      # total findings in this run
                "delta_json": str,          # JSON blob of deltas vs. previous run
                "report_hash": str,         # stable hash of report_json (dedup re-runs)
                "error": str,               # non-null if the refresh failed
            },
            pk="id",
        )
        db["topic_runs"].create_index(["topic"])
        db["topic_runs"].create_index(["topic", "run_at"])
        db["topic_runs"].create_index(["run_at"])

    # Phase 3 — Hypothesis tracking / decision journal.
    # Each hypothesis card produced by the Insight Engine (Phase 2) can be
    # promoted to a tracked "bet" via the UI's "Save as bet" button. Bets
    # persist across sessions and become the weekly-ritual surface: users
    # come back to mark them running / validated / invalidated with notes.
    # See docs/ROADMAP.md §"Phase 3" for the full spec.
    if "hypothesis_tests" not in db.table_names():
        db["hypothesis_tests"].create(
            {
                "id": str,                  # uuid4 hex, frontend-stable
                "topic": str,               # owning topic
                "card_json": str,           # full hypothesis card, frozen at save
                "status": str,              # draft | running | validated | invalidated | paused | archived
                "started_at": str,          # ISO UTC, set when status→running
                "resolved_at": str,         # ISO UTC, set when validated/invalidated
                "resolution_notes": str,    # free-form user notes
                "linked_evidence": str,     # JSON list of {kind, url, note} entries
                "last_updated": str,        # ISO UTC, any mutation bumps this
                "created_at": str,          # ISO UTC, set on insert
            },
            pk="id",
        )
        db["hypothesis_tests"].create_index(["topic"])
        db["hypothesis_tests"].create_index(["status"])
        db["hypothesis_tests"].create_index(["topic", "status"])

    # ── 2026-04-21 Tier-1..6 build — additive schema for new features ────
    # Soft-delete state on topic_prefs (T1.3). Nullable; NULL = not deleted.
    # Populated with ISO timestamp when a user deletes; nightly sweep
    # hard-purges rows older than 7 days.
    try:
        if "topic_prefs" in db.table_names():
            cols = {c.name for c in db["topic_prefs"].columns}
            if "deleted_at" not in cols:
                db.executescript("ALTER TABLE topic_prefs ADD COLUMN deleted_at TEXT DEFAULT ''")
    except Exception:
        pass

    # Finding feedback (T2.4) — user 👎 marking a finding as wrong / off-topic.
    # Fed back into next synthesize prompt as a negative-example block.
    if "finding_feedback" not in db.table_names():
        db["finding_feedback"].create(
            {
                "id": int,
                "topic": str,
                "finding_title": str,
                "finding_kind": str,      # painpoint | feature_wish | workaround | product
                "verdict": str,           # 'wrong' | 'off_topic' | 'spam' | 'ok'
                "note": str,
                "created_at": str,
            },
            pk="id",
        )
        db["finding_feedback"].create_index(["topic"])
        db["finding_feedback"].create_index(["topic", "verdict"])

    # Saved views (T3.1) — persisted filter expressions.
    if "saved_views" not in db.table_names():
        db["saved_views"].create(
            {
                "id": int,
                "scope": str,             # 'global' | 'topic:<slug>' | 'product:<id>'
                "name": str,
                "filter_json": str,
                "pinned": int,
                "created_at": str,
                "updated_at": str,
            },
            pk="id",
        )
        db["saved_views"].create_index(["scope"])
        db["saved_views"].create_index(["pinned"])

    # Favorites / pinned topics (T6.6).
    if "topic_favorites" not in db.table_names():
        db["topic_favorites"].create(
            {
                "topic": str,
                "position": int,
                "added_at": str,
            },
            pk="topic",
        )
        db["topic_favorites"].create_index(["position"])

    # Perf trace (T5.4) — rolling measurement of key sidecar calls.
    if "perf_traces" not in db.table_names():
        db["perf_traces"].create(
            {
                "id": int,
                "op": str,
                "topic": str,
                "duration_ms": int,
                "status": str,
                "notes": str,
                "ts": str,
            },
            pk="id",
        )
        db["perf_traces"].create_index(["op"])
        db["perf_traces"].create_index(["topic"])

    # Custom prompt overrides (T3.7) — per-template override set in Settings.
    if "prompt_overrides" not in db.table_names():
        db["prompt_overrides"].create(
            {
                "key": str,
                "override_text": str,
                "updated_at": str,
            },
            pk="key",
        )

    # ── Dual-Mode Pivot — Product Mode tables (2026-04-20) ───────────────
    # Adds a product-centric surface alongside the existing topic-centric
    # one. A Product is a first-class entity a PM/CEO opens every morning;
    # it owns a set of competitors, connected sources, and an append-only
    # signal stream produced by daily_product_sweep(). See
    # docs/DUAL_MODE_PIVOT.md §7 for the entity design.
    if "products" not in db.table_names():
        db["products"].create(
            {
                "id": str,                   # slug, e.g. "mindwave-pro"
                "name": str,
                "one_liner": str,
                "category": str,
                "topic": str,                # linked topic (for shared corpus + synthesis)
                "created_at": str,
                "last_swept_at": str,
                "monitoring_cadence": str,   # 'daily' | 'weekly'
                "is_active": int,            # 1/0
                "metadata_json": str,        # pricing notes, urls, etc.
            },
            pk="id",
        )
        db["products"].create_index(["is_active"])

    if "product_competitors" not in db.table_names():
        db["product_competitors"].create(
            {
                "product_id": str,
                "competitor_name": str,
                "urls_json": str,            # {"website":..,"appstore":..,"subreddit":..}
                "category": str,
                "tracked_since": str,
                "is_active": int,
            },
            pk=("product_id", "competitor_name"),
        )
        db["product_competitors"].create_index(["product_id"])

    if "product_signals" not in db.table_names():
        db["product_signals"].create(
            {
                "id": str,                   # uuid
                "product_id": str,
                "signal_type": str,          # competitor_release|chronic_emergence|your_product_regression|unmet_need_intensifying|competitor_vulnerability|mention_spike
                "severity": float,           # 0-1
                "confidence": float,         # 0-1
                "detected_at": str,
                "title": str,
                "description": str,
                "evidence_post_ids": str,    # JSON array
                "related_competitor": str,   # nullable
                "suggested_action": str,
                "user_action": str,          # nullable | dismissed | acted | snoozed | hypothesis
                "user_action_at": str,
                "snoozed_until": str,        # ISO UTC
                "resolution_notes": str,
                "created_at": str,
            },
            pk="id",
        )
        db["product_signals"].create_index(["product_id"])
        db["product_signals"].create_index(["product_id", "user_action"])
        db["product_signals"].create_index(["signal_type"])
        db["product_signals"].create_index(["detected_at"])

    if "product_sweeps" not in db.table_names():
        db["product_sweeps"].create(
            {
                "id": int,
                "product_id": str,
                "run_at": str,
                "trigger": str,              # manual | scheduled | initial
                "signals_generated": int,
                "posts_added": int,
                "duration_ms": int,
                "error": str,
                "notes": str,
            },
            pk="id",
        )
        db["product_sweeps"].create_index(["product_id"])
        db["product_sweeps"].create_index(["product_id", "run_at"])

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

    # Incremental enrichment — extraction_queue (2026-04-21).
    # Populated by collect + ingest; drained by the long-lived worker
    # (see research/enrich_worker.py). See
    # docs/superpowers/specs/2026-04-21-incremental-enrichment-design.md §3.
    _ensure_extraction_queue(db)


def _ensure_extraction_queue(db: Database) -> None:
    """Create the extraction_queue table + indexes, then backfill existing
    topic_posts that have no graph evidence yet. Idempotent: safe to call
    on every init_schema(), safe to call on installs that already have
    the table. INSERT OR IGNORE keeps the backfill safe across restarts."""
    if "extraction_queue" not in db.table_names():
        db["extraction_queue"].create(
            {
                "topic": str,
                "post_id": str,
                "kind": str,
                "queued_at": str,
                "attempted_at": str,
                "attempts": int,
                "last_error": str,
            },
            pk=("topic", "post_id", "kind"),
            defaults={"kind": "post", "attempts": 0},
        )
        db["extraction_queue"].create_index(["queued_at"])
        db["extraction_queue"].create_index(["topic"])

    # One-time (per-install) backfill: queue every existing topic_post that
    # has no graph evidence yet. Guarded on both tables existing AND on
    # graph_nodes.evidence_post_id existing — that column is added later in
    # the incremental-enrichment plan (Task 4). Until then, backfill is a
    # no-op; INSERT OR IGNORE makes repeated runs cheap.
    try:
        if "topic_posts" in db.table_names() and "graph_nodes" in db.table_names():
            gn_cols = {c.name for c in db["graph_nodes"].columns}
            if "evidence_post_id" in gn_cols:
                db.conn.execute(
                    """
                    INSERT OR IGNORE INTO extraction_queue (topic, post_id, kind, queued_at, attempts)
                    SELECT tp.topic, tp.post_id, 'post', datetime('now'), 0
                      FROM topic_posts tp
                      LEFT JOIN graph_nodes gn ON gn.evidence_post_id = tp.post_id
                        AND gn.topic = tp.topic
                     WHERE gn.id IS NULL
                    """
                )
            else:
                # Fallback until evidence_post_id ships: queue every
                # topic_post. The worker de-dups via the composite PK, so
                # re-running a topic that was already extracted inline is
                # harmless (rows just sit in the queue; worker drains them
                # and re-upserts findings idempotently).
                db.conn.execute(
                    """
                    INSERT OR IGNORE INTO extraction_queue (topic, post_id, kind, queued_at, attempts)
                    SELECT topic, post_id, 'post', datetime('now'), 0
                      FROM topic_posts
                    """
                )
            db.conn.commit()
    except Exception:
        # Backfill is best-effort. A failure here must NOT break app boot.
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
        # is_model_ready() also probes for the bundled / on-disk tar and
        # seeds it into the Chroma cache automatically — so a fresh MCP
        # process sees True the moment ChromaDB is ready to extract on
        # first embed. Callers that fetched-then-MCP-restarted will pick
        # the index up too.
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
