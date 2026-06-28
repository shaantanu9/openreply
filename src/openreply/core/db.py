"""SQLite schema + upsert helpers via sqlite-utils.

Tables mirror Reddit's model; every row has `fetched_at` so we can
track freshness without losing history.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, TypeVar

from sqlite_utils import Database

from .config import load_config
from .runctx import current_run_id


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── Transient-lock retry ───────────────────────────────────────────────────
# SQLite (even in WAL mode) permits exactly ONE writer at a time. When the
# collect pipeline fans external-source fetches out across a thread pool, every
# worker writes to the same `openreply.db` (fetch-audit row → posts → topic_posts).
# Writers serialize on a filesystem lock; `PRAGMA busy_timeout` (set in get_db)
# makes a single statement wait that long before giving up. This helper adds a
# second, application-level safety net: when a writer is held past the
# busy_timeout — common when a SECOND process (MCP server / Tauri sidecar /
# enrich worker) is also attached, or under a wide worker pool — we back off
# and retry instead of surfacing "database is locked" to the caller (which, in
# the source adapters, was killing the whole source's collection for that run).
_T = TypeVar("_T")

_DB_RETRY_ATTEMPTS = max(1, int(os.getenv("OPENREPLY_DB_RETRY_ATTEMPTS", "5") or "5"))
_DB_RETRY_BASE_SLEEP = 0.2  # seconds; exponential, capped per-sleep below
_DB_RETRY_MAX_SLEEP = 2.0


def _is_locked_err(e: BaseException) -> bool:
    """True for the transient, retryable SQLite contention errors."""
    if isinstance(e, sqlite3.OperationalError):
        msg = str(e).lower()
        return "locked" in msg or "busy" in msg or "disk i/o error" in msg
    # sqlite-utils / other layers occasionally re-wrap the OperationalError;
    # fall back to a message sniff so we don't miss a genuine lock.
    msg = str(e).lower()
    return "database is locked" in msg or "database table is locked" in msg


def _retry_on_locked(fn: Callable[..., _T], *args: Any, **kwargs: Any) -> _T:
    """Run a DB write, retrying with exponential backoff on transient locks.

    Re-raises any non-lock error immediately, and re-raises the lock error
    itself once attempts are exhausted (so a genuinely stuck DB still surfaces
    a real, debuggable error rather than silently dropping the write).
    """
    last: BaseException | None = None
    for attempt in range(_DB_RETRY_ATTEMPTS):
        try:
            return fn(*args, **kwargs)
        except Exception as e:  # noqa: BLE001 — re-raised below unless retryable
            if not _is_locked_err(e) or attempt == _DB_RETRY_ATTEMPTS - 1:
                raise
            last = e
            time.sleep(min(_DB_RETRY_BASE_SLEEP * (2 ** attempt), _DB_RETRY_MAX_SLEEP))
    raise last  # pragma: no cover — loop always returns or raises above


# Per-thread Database instance. sqlite3 connections are NOT safe to share
# across threads — they raise "SQLite objects created in a thread can only be
# used in that same thread". When the collect pipeline fans out source
# fetches in parallel, each worker needs its own connection. WAL mode (set
# below) lets multiple writers append concurrently without "database is
# locked". Schema init runs exactly once globally, guarded by a lock.
_tls = threading.local()
_schema_lock = threading.Lock()
_schema_inited = False
# Chroma Rust client can segfault on concurrent upserts across threads.
# Serialize palace writes while allowing SQLite upserts to stay parallel.
_palace_upsert_lock = threading.Lock()


_wal_self_heal_done = False


def _wal_self_heal(db_path: str) -> None:
    """Best-effort WAL recovery on first boot per process.

    When a Python sidecar / MCP daemon is hard-killed mid-write (or the
    Chroma HNSW writer crashes inside the same process and takes the
    sqlite WAL with it), the next process to open `openreply.db` can hit
    "database is locked" or "disk I/O error" on `openreply_query_db`.
    The safe fix is:
        sqlite3 openreply.db "PRAGMA wal_checkpoint(TRUNCATE);"

    DANGER — what this function must NEVER do: delete `openreply.db-wal` /
    `openreply.db-shm` while ANOTHER process has the database open. A WAL
    file holds committed-but-not-yet-checkpointed pages; deleting it
    discards every transaction that lives only in the WAL. With a
    second reader/writer attached (e.g. a Tauri sidecar AND an MCP
    server, or a stray standalone script), removing the side files
    silently destroys data that was never lost in the first place.
    (Battle-tested the hard way 2026-05-31: a standalone process ran
    this heal while two MCP servers held the DB; ~56k topic_posts rows
    that lived in the shared WAL were discarded.)

    So this helper now ONLY attempts a checkpoint. It never unlinks the
    side files. A genuinely corrupt WAL is a far rarer event than a
    multi-process attach, and the cure (deleting committed data) is
    worse than the disease. If a checkpoint truly cannot proceed, we
    leave the files untouched and let the normal connection surface a
    real, debuggable error instead of papering over it with data loss.

    Every step is swallowed so a healthy DB never pays a measurable
    cost. Idempotent across calls via `_wal_self_heal_done`.
    """
    global _wal_self_heal_done
    if _wal_self_heal_done:
        return
    _wal_self_heal_done = True
    try:
        import os as _os
        import sqlite3 as _sqlite3
        if not _os.path.isfile(db_path):
            return  # fresh DB will be created later
        # Checkpoint WAL — usual no-op on a clean DB, real fix when the
        # WAL has uncommitted frames left over from a hard kill. A PASSIVE
        # checkpoint never blocks or interferes with other connections; it
        # simply folds what it can into the main file. We deliberately do
        # NOT use TRUNCATE here (which needs an exclusive moment) and we
        # NEVER delete the -wal/-shm side files — doing so with another
        # process attached destroys committed data (see docstring).
        _conn = _sqlite3.connect(db_path, timeout=2.0, isolation_level=None)
        try:
            _conn.execute("PRAGMA busy_timeout=2000")
            _conn.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchall()
        finally:
            _conn.close()
    except Exception:
        # Never block boot on the heal path itself, and never escalate to
        # deleting side files. A real error will surface on first use.
        pass


def get_db() -> Database:
    global _schema_inited
    db = getattr(_tls, "db", None)
    if db is None:
        cfg = load_config()
        # Run WAL self-heal BEFORE opening the long-lived connection so
        # we don't hold the DB open while removing the sidecar files.
        _wal_self_heal(cfg.db_path)
        db = Database(cfg.db_path)
        # WAL: concurrent readers never block; concurrent writers serialize
        # briefly on a filesystem-level lock (5s busy-timeout absorbs rare
        # collisions). Set per-connection so the very first call in each
        # thread flips the pragma.
        db.conn.execute("PRAGMA journal_mode=WAL")
        # Bumped 5000 → 15000 (2026-06-07): under the widened external-source
        # worker pool (and when an MCP server / sidecar is also attached), a
        # writer can hold the lock past 5s, and source adapters surfaced
        # "database is locked" — collecting 0 rows for that source. 15s absorbs
        # the realistic worst case; `_retry_on_locked` is the second net beyond
        # it. Env-tunable so a deploy can raise it without a rebuild.
        _busy_ms = max(1000, int(os.getenv("OPENREPLY_DB_BUSY_TIMEOUT_MS", "15000") or "15000"))
        db.conn.execute(f"PRAGMA busy_timeout={_busy_ms}")
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
    OPENREPLY_DATA_DIR per test).
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

    if "source_credentials" not in db.table_names():
        # Per-source auth (cookies / api keys) for the Reach Connections flow.
        # One row per source; cookie_json is a JSON map of cookie name->value.
        db["source_credentials"].create(
            {
                "source": str,            # "reddit", "xueqiu", "xiaohongshu", ...
                "cookie_json": str,       # JSON {name: value}
                "username": str,
                "kind": str,              # "cookie" | "api_key" | "login_pair" | "public"
                "saved_at": str,
                "last_verified_at": str,
                "enabled": int,           # 1 = include in collection runs (default)
            },
            pk="source",
        )
    else:
        # Migration: add `enabled` (use-in-collection toggle) to pre-existing DBs.
        cols = {c.name for c in db["source_credentials"].columns}
        if "enabled" not in cols:
            db.executescript(
                "ALTER TABLE source_credentials ADD COLUMN enabled INTEGER DEFAULT 1"
            )

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
        # Hot paths the Activity tab + dashboard counter queries hit:
        #   - sparkline:    GROUP BY substr(started_at,1,10) WHERE substr ≥ ...
        #   - kind filter:  WHERE kind = ? (or kind LIKE 'source:%')
        #   - errors-only:  WHERE error IS NOT NULL ORDER BY started_at DESC
        #   - live-check:   WHERE ended_at IS NULL LIMIT 1
        # Indices for (kind, started_at) + (started_at) cover all four.
        db["fetches"].create_index(["started_at"])
        db["fetches"].create_index(["kind", "started_at"])

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

    # user_feeds: user-added custom RSS/Atom feed URLs. Swept on every collect
    # via the `rss_user` source (sources/collect_adapter.run_rss_user). The
    # desktop Settings UI manages rows through the `feeds` CLI subcommand.
    if "user_feeds" not in db.table_names():
        db["user_feeds"].create(
            {
                "url": str,
                "name": str,
                "enabled": int,   # 1 = swept on collect, 0 = paused
                "added_at": str,
            },
            pk="url",
        )

    # PDF ingest provenance: document-level artifact metadata + element-level
    # coordinates/types from opendataloader JSON. This powers "open source
    # location" UX and future graph evidence edges without overloading posts.
    if "ingested_documents" not in db.table_names():
        db["ingested_documents"].create(
            {
                "id": str,
                "topic": str,
                "post_id": str,
                "source_path": str,
                "source_hash": str,
                "source_type": str,
                "parser": str,
                "parser_mode": str,
                "artifact_dir": str,
                "created_at": str,
            },
            pk="id",
        )
        db["ingested_documents"].create_index(["topic"])
        db["ingested_documents"].create_index(["post_id"])

    if "document_elements" not in db.table_names():
        db["document_elements"].create(
            {
                "id": str,
                "document_id": str,
                "post_id": str,
                "topic": str,
                "element_id": str,
                "element_type": str,
                "content": str,
                "page_number": int,
                "bbox_json": str,
                "created_at": str,
            },
            pk="id",
        )
        db["document_elements"].create_index(["document_id"])
        db["document_elements"].create_index(["post_id"])
        db["document_elements"].create_index(["topic"])

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
                "evidence_post_id": str,  # incremental-enrichment — the post
                                          # that triggered this finding (Task 4)
                "provenance": str,      # source/run provenance tag
                "debate_tier": str,     # FSD Fleet Phase 1 — render cache
                "consensus_score": float,  # 0..1 from last debate
                "debated_at": str,      # ISO UTC of last debate stamp
            },
            pk="id",
        )
        db["graph_nodes"].create_index(["topic"])
        db["graph_nodes"].create_index(["kind"])
        db["graph_nodes"].create_index(["topic", "kind"])
        db["graph_nodes"].create_index(["evidence_post_id"])
    else:
        # Lazy migration for pre-2026-04-19 installs. Existing rows get an
        # empty ts → they bucket as "stable" in diff_findings, which is
        # correct (we have no creation timestamp so treat as baseline).
        _cols = {c.name for c in db["graph_nodes"].columns}
        if "ts" not in _cols:
            db.executescript("ALTER TABLE graph_nodes ADD COLUMN ts TEXT DEFAULT ''")
        # 2026-04-21 incremental-enrichment (Task 4): per-finding evidence
        # post pointer. Nullable TEXT; populated by enrich_from_llm_for_posts.
        # Indexed because the backfill in _ensure_extraction_queue joins on it.
        if "evidence_post_id" not in _cols:
            try:
                db.executescript(
                    "ALTER TABLE graph_nodes ADD COLUMN evidence_post_id TEXT DEFAULT ''"
                )
                db["graph_nodes"].create_index(["evidence_post_id"], if_not_exists=True)
            except Exception:
                pass
        if "provenance" not in _cols:
            db.executescript("ALTER TABLE graph_nodes ADD COLUMN provenance TEXT DEFAULT ''")
        # FSD Fleet Phase 1 — denormalized debate render cache.
        if "debate_tier" not in _cols:
            try:
                db.executescript("ALTER TABLE graph_nodes ADD COLUMN debate_tier TEXT DEFAULT ''")
                db.executescript("ALTER TABLE graph_nodes ADD COLUMN consensus_score REAL DEFAULT 0")
                db.executescript("ALTER TABLE graph_nodes ADD COLUMN debated_at TEXT DEFAULT ''")
            except Exception:
                pass

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

    if "checks_ledger" not in db.table_names():
        db["checks_ledger"].create({
            "id": int, "topic": str, "run_id": str, "gate": str, "operation": str,
            "provider": str, "model": str, "invariant": str, "passed": int,
            "exit_code": int, "detail": str, "ts": str,
        }, pk="id")
        db["checks_ledger"].create_index(["topic"])
        db["checks_ledger"].create_index(["run_id"])
        db["checks_ledger"].create_index(["topic", "gate"])
    if "lineage" not in db.table_names():
        db["lineage"].create({
            "id": int, "topic": str, "artifact_id": str, "artifact_kind": str,
            "produced_by": str, "from_post_ids": str, "decision": str,
            "provider": str, "model": str, "ts": str,
        }, pk="id")
        db["lineage"].create_index(["artifact_id"])
        db["lineage"].create_index(["topic"])
        db["lineage"].create_index(["produced_by"])

    # Academic Mode — one row per finalized research brief (research →
    # synthesize → peer_review → finalize). Keyed by run_id; the UI reads the
    # latest by generated_at.
    if "academic_briefs" not in db.table_names():
        db["academic_briefs"].create({
            "run_id": str, "topic": str, "level": str, "gate_status": str,
            "grounded_count": int, "stages_json": str, "markdown": str,
            "fmt": str, "export_path": str, "limitations": str,
            "citations_json": str, "generated_at": str,
            # Multi-agent upgrade — panel decision + integrity verdict + verified count.
            "review_decision": str, "integrity_verdict": str, "citations_verified": int,
        }, pk="run_id")
        db["academic_briefs"].create_index(["topic"])
        db["academic_briefs"].create_index(["generated_at"])
    else:
        # Lazy migration for installs created before the multi-agent columns.
        _ab_cols = {c.name for c in db["academic_briefs"].columns}
        for _col, _sql_type, _default in (("review_decision", "TEXT", "''"),
                                          ("integrity_verdict", "TEXT", "''"),
                                          ("citations_verified", "INTEGER", "0")):
            if _col not in _ab_cols:
                try:
                    db.executescript(
                        f"ALTER TABLE academic_briefs ADD COLUMN {_col} {_sql_type} DEFAULT {_default}"
                    )
                except Exception:
                    pass

    # FSD Fleet — Phase 1. One row per debate run over a topic's findings,
    # plus one verdict row per (finding|node) tiered by the 5-persona
    # deliberation. `debate_runs` is the lightweight audit record (Phase 3
    # expands it into the cost/replay panel); `debate_verdicts` is the
    # canonical source of truth for trust badges. The denormalized
    # graph_nodes.debate_* columns (added in the graph_nodes block above)
    # are a render cache so map-node badges paint without a join.
    if "debate_runs" not in db.table_names():
        db["debate_runs"].create({
            "id": int, "topic": str, "run_id": str, "rounds": int,
            "personas_used_json": str, "status": str, "cost_tokens": int,
            "provider": str, "model": str, "started_at": str, "finished_at": str,
            "transcript_json": str,   # Phase 3 — per-round per-persona timeline
            "counts_json": str,       # Phase 3 — tier counts + llm_calls proxy
        }, pk="id")
        db["debate_runs"].create_index(["topic"])
        db["debate_runs"].create_index(["run_id"])
    else:
        # Phase 3 lazy migration — audit/replay timeline columns.
        _dr_cols = {c.name for c in db["debate_runs"].columns}
        if "transcript_json" not in _dr_cols:
            try:
                db.executescript("ALTER TABLE debate_runs ADD COLUMN transcript_json TEXT DEFAULT ''")
                db.executescript("ALTER TABLE debate_runs ADD COLUMN counts_json TEXT DEFAULT ''")
            except Exception:
                pass
    if "debate_verdicts" not in db.table_names():
        db["debate_verdicts"].create({
            "id": int, "topic": str,
            "target_kind": str,            # 'finding' | 'node'
            "target_id": str,              # finding title-key or graph_nodes.id
            "tier": str,                   # confirmed|probable|minority|discarded
            "consensus_score": float,      # 0..1
            "dissent_json": str,           # [{persona, why}] of DISPUTE voters
            "evidence_post_ids_json": str, # supporting post ids
            "transcript_ref": str,         # debate_runs.run_id
            "findings_hash": str,          # staleness key
            "provenance": str,             # 'debated' | 'llm_fallback'
            "run_id": str, "provider": str, "model": str,
            "created_at": str,             # ISO UTC
        }, pk="id")
        db["debate_verdicts"].create_index(["topic", "target_id"])
        db["debate_verdicts"].create_index(["topic", "run_id"])

    # FSD Fleet — Phase 4. One row per orchestrated "fleet flow" run over a
    # topic (decision-gate → route → clarify → ground → debate → synthesize).
    # `stages_json` is the per-stage timeline the UI renders.
    if "fleet_runs" not in db.table_names():
        db["fleet_runs"].create({
            "id": int, "topic": str, "run_id": str, "route": str, "mode": str,
            "status": str, "stages_json": str, "signals_json": str,
            "cost_tokens": int, "started_at": str, "finished_at": str,
        }, pk="id")
        db["fleet_runs"].create_index(["topic"])
        db["fleet_runs"].create_index(["run_id"])

    if "paper_gaps" not in db.table_names():
        db["paper_gaps"].create({
            "id": str, "topic": str, "kind": str, "title": str,
            "detail_json": str, "evidence_post_ids_json": str,
            "score": float, "created_at": str,
        }, pk="id")
        db["paper_gaps"].create_index(["topic", "kind"])

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
            # Intent layer (2026-04-21 intent-layer spec). One nullable column
            # drives per-topic deliverable routing in the UI. NULL → treat as
            # 'product-new' so old topics behave identically to pre-migration.
            if "intent" not in cols:
                db.executescript("ALTER TABLE topic_prefs ADD COLUMN intent TEXT DEFAULT 'product-new'")
            # Clarified-brief columns (2026-06-14). Four nullable text fields
            # scoping synthesis to the user's stated goal/constraints/success/audience.
            cols = {c.name for c in db["topic_prefs"].columns}  # re-read after prior ALTERs
            for _bc in ("brief_goal", "brief_constraints", "brief_success", "brief_audience"):
                if _bc not in cols:
                    db.executescript(f"ALTER TABLE topic_prefs ADD COLUMN {_bc} TEXT DEFAULT ''")
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

    # Persistent topic AI chat conversations (2026-05-31) — ChatGPT-style
    # saved threads per topic. Stored as a JSON message-array blob per
    # conversation (mirrors the UI's in-memory chatHistory shape). Reads
    # and writes go through the native Rust path (db.rs chat_conv_*); this
    # block just guarantees the table exists for fresh databases.
    if "chat_conversations" not in db.table_names():
        db["chat_conversations"].create(
            {
                "id": str,             # client-generated conversation id
                "topic": str,
                "title": str,          # auto from first user message, renameable
                "messages_json": str,  # full message array (UI chatHistory shape)
                "msg_count": int,
                "created_at": int,     # epoch ms
                "updated_at": int,     # epoch ms (sort key)
            },
            pk="id",
        )
        db["chat_conversations"].create_index(["topic", "updated_at"])
        db["chat_conversations"].create_index(["updated_at"])

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

    # MCP analyses — unified log of LLM-driven intelligence produced either
    # by MCP tools (source='mcp') or by the app's own pipelines (source='app').
    # The GUI's topic page reads this table to show "AI Analyses" so users see
    # what the client LLM (or the app) concluded, independent of which
    # domain-specific table the primary result lives in.
    if "mcp_analyses" not in db.table_names():
        db["mcp_analyses"].create(
            {
                "id": int,                 # autoincrement
                "topic": str,              # topic context (may be empty for global)
                "kind": str,               # summary | synthesis | cluster_note | conclusion | paper_analysis | subreddit_ranking | insights | gaps
                "source": str,             # 'mcp' | 'app'
                "tool": str,               # which MCP tool / pipeline produced it
                "params_json": str,        # input args, for reproducibility
                "content": str,            # markdown or JSON blob (see content_type)
                "content_type": str,       # 'markdown' | 'json'
                "provider": str,           # resolved LLM provider ('' if deterministic)
                "model": str,              # LLM_MODEL at write-time ('' if deterministic)
                "tokens_in": int,
                "tokens_out": int,
                "created_at": str,         # ISO UTC
            },
            pk="id",
        )
        db["mcp_analyses"].create_index(["topic", "created_at"])
        db["mcp_analyses"].create_index(["topic", "kind", "created_at"])
        db["mcp_analyses"].create_index(["source"])

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

    # Task 9.5 — extraction_daily_usage + topic_prefs extraction columns.
    # Tracks daily LLM token spend per (provider, model) so the worker can
    # enforce the user's daily_token_cap and the Settings pane can surface
    # a running cost estimate. See design spec §12.
    _ensure_extraction_prefs_schema(db)

    # Lifecycle pivot (2026-05-01) — Stage-Gate verdicts on products and
    # Kano category metadata is stored on intervention graph_nodes via
    # metadata_json (no schema change needed). Adds nullable columns so
    # pre-existing product rows survive without data loss.
    _ensure_lifecycle_schema(db)

    # Persona agents (2026-05-12) — single-lens learning agents that
    # auto-ingest every collected post relevant to their goal. Memories
    # are LLM-distilled 1-3 sentence lessons with a source-post evidence
    # trail. Edges + conclusions are populated by Phase-2 consolidation.
    _ensure_persona_schema(db)

    # ── Retro-add hot-path indices (2026-05-30) ─────────────────────────
    # `create_index` in the table-create blocks above only fires the first
    # time a table is created. For databases that already exist (every user
    # who's run a previous version), the indices below were never added.
    # `IF NOT EXISTS` is safe on every startup; SQLite materializes once.
    #
    # Hot paths these cover:
    #   - Activity tab sparkline (GROUP BY substr(started_at,1,10)).
    #   - Activity table filter (WHERE kind = ? OR kind LIKE 'source:%').
    #   - Errors-only filter (WHERE error IS NOT NULL ORDER BY started_at).
    #   - "Is a collect running?" probe (WHERE ended_at IS NULL LIMIT 1).
    _retro_idx = [
        "CREATE INDEX IF NOT EXISTS idx_fetches_started_at ON fetches(started_at)",
        "CREATE INDEX IF NOT EXISTS idx_fetches_kind_started ON fetches(kind, started_at)",
        "CREATE INDEX IF NOT EXISTS idx_fetches_ended_at ON fetches(ended_at) WHERE ended_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_topic_posts_topic ON topic_posts(topic)",
        "CREATE INDEX IF NOT EXISTS idx_topic_posts_post ON topic_posts(post_id)",
    ]
    for _stmt in _retro_idx:
        try:
            db.conn.execute(_stmt)
        except Exception:
            pass  # older SQLite or partial-index unsupported — fall back to scans

    # Refresh planner stats so the optimizer picks the new indices on the
    # next query. Best-effort; ANALYZE is idempotent and cheap.
    try:
        db.conn.execute("ANALYZE")
    except Exception:
        pass


def _ensure_persona_schema(db: Database) -> None:
    """Create persona tables + seed the default "Psyche" persona. Idempotent."""
    now = _utc_now()
    if "personas" not in db.table_names():
        db["personas"].create(
            {
                "id": int,
                "name": str,
                "goal": str,
                "lens": str,
                "system_prompt": str,
                "color": str,
                "icon": str,
                "active": int,
                "created_at": str,
                "updated_at": str,
            },
            pk="id",
        )
        db["personas"].create_index(["name"], unique=True)

    if "persona_memories" not in db.table_names():
        db["persona_memories"].create(
            {
                "id": int,
                "persona_id": int,
                "source_post_id": str,
                "topic": str,
                "lesson": str,
                "excerpt": str,
                "tags": str,
                "importance": float,
                "created_at": str,
            },
            pk="id",
            foreign_keys=[("persona_id", "personas", "id")],
        )
        db["persona_memories"].create_index(["persona_id"])
        db["persona_memories"].create_index(["persona_id", "topic"])
        db["persona_memories"].create_index(["persona_id", "source_post_id"], unique=True)

    if "persona_edges" not in db.table_names():
        db["persona_edges"].create(
            {
                "id": int,
                "persona_id": int,
                "from_memory_id": int,
                "to_memory_id": int,
                "kind": str,
                "weight": float,
                "created_at": str,
            },
            pk="id",
        )
        db["persona_edges"].create_index(["persona_id"])
        db["persona_edges"].create_index(["from_memory_id"])
        db["persona_edges"].create_index(["to_memory_id"])

    if "persona_conclusions" not in db.table_names():
        db["persona_conclusions"].create(
            {
                "id": int,
                "persona_id": int,
                "statement": str,
                "evidence_memory_ids": str,
                "confidence": float,
                "created_at": str,
                "updated_at": str,
            },
            pk="id",
        )
        db["persona_conclusions"].create_index(["persona_id"])

    # Phase 4c (2026-05-12) — when share_memory() is called but the receiver's
    # lens says "not relevant", record it. Over time this builds a map of where
    # personas' worldviews diverge — the lens-edges of the agent ecosystem.
    if "persona_rejections" not in db.table_names():
        db["persona_rejections"].create(
            {
                "id": int,
                "from_persona_id": int,
                "from_memory_id": int,
                "to_persona_id": int,
                "donor_lesson": str,
                "reason": str,
                "created_at": str,
            },
            pk="id",
        )
        db["persona_rejections"].create_index(["to_persona_id"])
        db["persona_rejections"].create_index(["from_persona_id"])

    # Seed default persona on a fresh install. Users can edit/disable later.
    if db.execute("SELECT COUNT(*) FROM personas").fetchone()[0] == 0:
        db["personas"].insert({
            "name": "Psyche",
            "goal": "Learn human psychology from every corpus, regardless of topic.",
            "lens": "psychology",
            "system_prompt": (
                "You are Psyche, a learning agent whose sole goal is to extract "
                "psychological insights — cognitive biases, motivations, emotions, "
                "social dynamics, behavior patterns — from anything you read."
            ),
            "color": "#7c3aed",
            "icon": "brain",
            "active": 1,
            "created_at": now,
            "updated_at": now,
        })


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


def _ensure_extraction_prefs_schema(db: Database) -> None:
    """Task 9.5 — daily token usage tracking + per-topic extraction overrides.

    Two additive migrations:

    1. Create ``extraction_daily_usage`` keyed by ``(day, provider, model)``.
       Each row tracks cumulative tokens-in / tokens-out / est-USD for one
       calendar day (local midnight reset). The worker runs UPSERT-style
       writes (INSERT OR IGNORE then UPDATE … SET x=x+?) after every
       successful LLM call.
    2. Extend ``topic_prefs`` with nullable extraction-override columns so
       a user can override the global defaults per-topic. NULL means "use
       the global default from extraction.json". Every ALTER is wrapped in
       try/except so pre-existing rows survive.
    """
    if "extraction_daily_usage" not in db.table_names():
        db["extraction_daily_usage"].create(
            {
                "day": str,           # ISO date, e.g. 2026-04-21 (local)
                "provider": str,      # resolved LLM provider name
                "model": str,         # LLM_MODEL env value at write-time
                "tokens_in": int,
                "tokens_out": int,
                "est_usd": float,
            },
            pk=("day", "provider", "model"),
            defaults={"tokens_in": 0, "tokens_out": 0, "est_usd": 0.0},
        )
        db["extraction_daily_usage"].create_index(["day"])

    # Per-topic extraction overrides. All nullable — absent values fall back
    # to the global default stored in ``extraction.json``. Old databases
    # created before this migration have `topic_prefs` without these
    # columns; the try/except handles that.
    try:
        if "topic_prefs" in db.table_names():
            cols = {c.name for c in db["topic_prefs"].columns}
            # (column, python type) — sqlite-utils maps to TEXT / INTEGER / REAL.
            add_cols = [
                ("extraction_mode", str),           # 'auto' | 'manual' | 'scheduled'
                ("extraction_threshold", int),      # 50–500
                ("extraction_batch_size", int),     # 1–20
                ("extraction_window_start", str),   # HH:MM local (scheduled mode)
                ("extraction_window_end", str),     # HH:MM local
                ("daily_token_cap", int),           # tokens per day, NULL = unlimited
                ("release_llm_idle", int),          # 0/1, send keep_alive:0 to Ollama
            ]
            for name, typ in add_cols:
                if name not in cols:
                    try:
                        db["topic_prefs"].add_column(name, typ)
                    except Exception:
                        # Some sqlite-utils versions raise when the column
                        # raced in via another connection. Harmless — the
                        # schema is converging.
                        pass
    except Exception:
        # Table missing entirely is fine — the block above creates it with
        # the original columns; these extras just won't exist on very old
        # rows (and the worker tolerates missing columns).
        pass


def _ensure_lifecycle_schema(db: Database) -> None:
    """Lifecycle pivot — Stage-Gate verdict on products + Kano metadata.

    All migrations are additive and idempotent: pre-existing installs gain
    the columns without touching their data. Kano category lives in
    ``graph_nodes.metadata_json`` (free-form JSON column already used by
    interventions for confidence_tier/effort/rationale) — no schema change
    required for Kano on the graph side. MoSCoW and RICE tags also live in
    ``graph_nodes.metadata_json`` for the same reason.
    """
    try:
        if "products" in db.table_names():
            cols = {c.name for c in db["products"].columns}
            add_cols = [
                ("gate_status", str),       # '' | 'go' | 'kill' | 'hold' | 'recycle'
                ("gate_decided_at", str),   # ISO UTC of last decision
                ("gate_notes", str),        # free-text rationale
                # Discovery framework artefacts (2026-05-01_04 expansion):
                ("four_risks_json", str),   # Cagan: value/usability/feasibility/viability
                ("tam_sam_som_json", str),  # market sizing per Blank/Dorf
                ("value_curve_json", str),  # Blue Ocean factor scoring
                ("outcome", str),           # OST root: desired business outcome
            ]
            for name, typ in add_cols:
                if name not in cols:
                    try:
                        db["products"].add_column(name, typ)
                    except Exception:
                        pass
    except Exception:
        pass

    # OST experiments — terminal nodes of the Opportunity Solution Tree
    # (Torres, 2016). Distinct from the older ``experiments`` table that
    # gap_discovery.py uses for LLM-proposed paper-grounded experiment
    # designs (different schema, different lifecycle). OST experiments
    # are user-tracked falsifiable bets attached to interventions.
    if "ost_experiments" not in db.table_names():
        try:
            db["ost_experiments"].create(
                {
                    "id": str,
                    "topic": str,
                    "painpoint_id": str,         # graph_nodes.id of the painpoint
                    "intervention_id": str,      # graph_nodes.id of the intervention (may be empty)
                    "hypothesis": str,           # "We believe X will cause Y because Z"
                    "method": str,               # 'fake_door' | 'landing_page' | 'wizard_of_oz' | 'concierge' | 'survey' | 'custom'
                    "success_criteria": str,
                    "sample_size": int,
                    "status": str,               # 'planned' | 'running' | 'validated' | 'invalidated' | 'inconclusive'
                    "result_notes": str,
                    "created_at": str,
                    "updated_at": str,
                },
                pk="id",
                defaults={"status": "planned", "sample_size": 0},
            )
            db["ost_experiments"].create_index(["topic"])
            db["ost_experiments"].create_index(["painpoint_id"])
            db["ost_experiments"].create_index(["intervention_id"])
        except Exception:
            pass

    # Empathy maps — Says / Thinks / Does / Feels per (topic, persona).
    if "empathy_maps" not in db.table_names():
        try:
            db["empathy_maps"].create(
                {
                    "id": str,                    # f"{topic}::{persona_slug}"
                    "topic": str,
                    "persona": str,
                    "says_json": str,             # JSON list of verbatim quotes
                    "thinks_json": str,           # JSON list of inferred beliefs
                    "does_json": str,             # JSON list of observed behaviours / workarounds
                    "feels_json": str,            # JSON list of emotion clusters
                    "gap_notes": str,             # the Says-vs-Does insight
                    "created_at": str,
                    "updated_at": str,
                },
                pk="id",
            )
            db["empathy_maps"].create_index(["topic"])
        except Exception:
            pass

    # Customer Discovery Interviews (Mom Test, Fitzpatrick 2013) — manually
    # captured 1:1 interviews with potential users. Distinct from raw
    # `posts` (social-media corpus) — these are real conversations a PM
    # ran themselves.
    if "interviews" not in db.table_names():
        try:
            db["interviews"].create(
                {
                    "id": str,
                    "topic": str,
                    "product_id": str,            # optional FK
                    "interviewee_name": str,
                    "persona": str,               # which user persona
                    "interviewer": str,
                    "conducted_at": str,          # ISO date
                    "duration_min": int,
                    "channel": str,               # 'video' | 'phone' | 'inperson' | 'async'
                    "summary": str,               # short PM-written digest
                    "full_text": str,             # transcript / raw notes
                    "current_solution": str,      # what they use today
                    "willingness_to_pay": str,    # free text or amount
                    "jtbd_quote": str,            # best JTBD quote
                    "mom_test_score": int,        # 0..5 — interview rigour self-rating
                    "follow_up": str,             # 'pending' | 'done' | 'none'
                    "tags_json": str,             # arbitrary tags
                    "created_at": str,
                    "updated_at": str,
                },
                pk="id",
                defaults={"duration_min": 0, "mom_test_score": 0},
            )
            db["interviews"].create_index(["topic"])
            db["interviews"].create_index(["product_id"])
        except Exception:
            pass

    # Sean Ellis PMF Survey (Ellis 2010) — single-question survey
    # (How would you feel if you could no longer use this product?).
    # Threshold: ≥40% answer "very disappointed" → product-market fit.
    if "pmf_responses" not in db.table_names():
        try:
            db["pmf_responses"].create(
                {
                    "id": str,
                    "topic": str,
                    "product_id": str,            # optional
                    "responded_at": str,
                    "respondent": str,            # email / handle / anonymized id
                    "persona": str,               # segment for slicing
                    # core: very_disappointed | somewhat_disappointed |
                    # not_disappointed | dont_use
                    "disappointment": str,
                    "must_have_alternative": str, # follow-up: what would you use instead?
                    "main_benefit": str,          # what's the main benefit?
                    "ideal_user": str,            # who do you think would benefit most?
                    "improvement": str,           # how can we improve?
                    "notes": str,
                    "created_at": str,
                },
                pk="id",
            )
            db["pmf_responses"].create_index(["topic"])
            db["pmf_responses"].create_index(["product_id"])
        except Exception:
            pass

    # Survey responses — Van Westendorp PSM, NPS, MaxDiff. Single table
    # so the UI can mix instruments freely; payload lives in data_json.
    if "survey_responses" not in db.table_names():
        try:
            db["survey_responses"].create(
                {
                    "id": str,
                    "topic": str,
                    "product_id": str,
                    "kind": str,                  # 'vw' | 'nps' | 'maxdiff'
                    "respondent": str,
                    "persona": str,
                    "data_json": str,             # instrument-specific payload
                    "responded_at": str,
                    "created_at": str,
                },
                pk="id",
            )
            db["survey_responses"].create_index(["topic"])
            db["survey_responses"].create_index(["product_id"])
            db["survey_responses"].create_index(["kind"])
        except Exception:
            pass

    # PERT estimation tasks (US Navy 1958, McConnell 2006). Each task
    # has Optimistic / Most Likely / Pessimistic estimates;
    # E = (O + 4M + P) / 6, SD = (P - O) / 6.
    if "pert_tasks" not in db.table_names():
        try:
            db["pert_tasks"].create(
                {
                    "id": str,
                    "product_id": str,
                    "label": str,
                    "role": str,                  # eng | design | qa | pm
                    "optimistic": float,          # days
                    "most_likely": float,
                    "pessimistic": float,
                    "notes": str,
                    "tier": str,                  # 'mvp' | 'standard' | 'full'
                    "created_at": str,
                    "updated_at": str,
                },
                pk="id",
                defaults={
                    "optimistic": 0.0, "most_likely": 0.0, "pessimistic": 0.0,
                    "role": "eng", "tier": "mvp",
                },
            )
            db["pert_tasks"].create_index(["product_id"])
            db["pert_tasks"].create_index(["tier"])
        except Exception:
            pass

    # Additional product-level columns for Porter's Five Forces, 2x2
    # positioning map, cost model. Kept as JSON columns to stay
    # schema-stable.
    try:
        if "products" in db.table_names():
            cols = {c.name for c in db["products"].columns}
            extra_cols = [
                ("porter_forces_json", str),     # Porter Five Forces (1979)
                ("positioning_map_json", str),   # 2x2 positioning map (Ries/Trout)
                ("cost_model_json", str),        # dev + infra + maint + LTV/CAC
            ]
            for name, typ in extra_cols:
                if name not in cols:
                    try:
                        db["products"].add_column(name, typ)
                    except Exception:
                        pass
    except Exception:
        pass

    # Idea scans — fast-pass discovery from a 2-word seed.
    # The orchestrator fans out across enabled sources, halts the
    # moment the running item count crosses ~200, then writes the
    # raw items into `posts` (tagged via `topic_posts` with the
    # scan_id as topic prefix) and a top-5 cluster summary into
    # `clusters_json`. Status transitions:
    #   pending → fetching → halted_at_threshold | completed | error
    #            → synthesizing → ready
    # Re-runs (the "Keep fetching" decision) reuse the row, append
    # to `sources_hit_json`, and bump `total_items` + `updated_at`.
    if "idea_scans" not in db.table_names():
        try:
            db["idea_scans"].create(
                {
                    "id": str,                    # uuid
                    "seed": str,                  # the 2-word user input
                    "search_topic": str,          # canonical (post-LLM expansion)
                    "status": str,                # pending|fetching|halted|completed|error|synthesizing|ready
                    "halt_threshold": int,        # default 200; configurable
                    "total_items": int,           # running sum across all sources
                    "sources_planned_json": str,  # JSON list[str] — what was queued
                    "sources_hit_json": str,      # JSON dict[str,int] — counts by source
                    "sources_pending_json": str,  # JSON list[str] — not yet run (for extend)
                    "clusters_json": str,         # JSON list of {label, jtbd, mention_count, source_count, sample_quotes}
                    "llm_provider": str,          # resolved name at scan time
                    "llm_model": str,             # resolved model
                    "error": str,                 # last error message
                    "created_at": str,
                    "updated_at": str,
                    "halted_at": str,
                    "synthesized_at": str,
                },
                pk="id",
                defaults={
                    "status": "pending",
                    "halt_threshold": 200,
                    "total_items": 0,
                },
            )
            db["idea_scans"].create_index(["status"])
            db["idea_scans"].create_index(["created_at"])
        except Exception:
            pass


def _ensure_experiments_pk_compat(db: Database) -> None:
    """Some early-pre-experiments schemas may have created the table without
    a string pk — no-op if the table already matches. Kept separate so the
    main lifecycle migration stays trivially idempotent."""
    return None


# ── Fetch audit log ──────────────────────────────────────────────────────────

def log_fetch_start(kind: str, params: dict[str, Any]) -> int:
    """Open a fetch-audit row. Returns the row id, or -1 if the (non-critical)
    audit write could not complete.

    This is bookkeeping ONLY — it MUST NOT be able to kill a real data fetch.
    In the source adapters this call sits before the try/except that guards the
    fetch+persist loop, so a propagating "database is locked" here used to abort
    the entire source (0 rows collected). We retry on transient locks and, if
    they truly persist, swallow the error and return -1 so the caller proceeds
    to actually fetch + persist data. `log_fetch_end(-1, …)` is a no-op.
    """
    db = get_db()

    def _insert() -> int:
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

    try:
        return _retry_on_locked(_insert)
    except Exception:
        return -1


def log_fetch_end(fetch_id: int, rows: int, error: str | None = None) -> None:
    # -1 sentinel means log_fetch_start could not open the audit row; nothing
    # to update. Audit bookkeeping never raises to the caller.
    if fetch_id is None or fetch_id < 0:
        return
    db = get_db()
    try:
        _retry_on_locked(
            db["fetches"].update,
            fetch_id,
            {"ended_at": _utc_now(), "rows": rows, "error": error},
        )
    except Exception:
        pass


def record_check(*, topic: str, gate: str, operation: str, passed: bool,
                 run_id: str | None = None, provider: str = "", model: str = "",
                 invariant: str = "", exit_code: int = 0, detail: str = "") -> int:
    """Record one quality gate. Best-effort — returns row id or -1. NEVER raises."""
    try:
        db = get_db()

        def _ins() -> int:
            return db["checks_ledger"].insert({
                "topic": topic, "run_id": run_id if run_id is not None else current_run_id(),
                "gate": gate, "operation": operation, "provider": provider, "model": model,
                "invariant": invariant, "passed": 1 if passed else 0, "exit_code": exit_code,
                "detail": (detail or "")[:2000], "ts": _utc_now(),
            }).last_pk

        return _retry_on_locked(_ins)
    except Exception:
        return -1


def record_lineage(*, topic: str, artifact_id: str, artifact_kind: str,
                   produced_by: str | None = None, from_post_ids: list[str] | None = None,
                   decision: str = "", provider: str = "", model: str = "") -> int:
    """Link an artifact to the sources/run that produced it. Best-effort, -1 on failure, never raises."""
    try:
        db = get_db()

        def _ins() -> int:
            return db["lineage"].insert({
                "topic": topic, "artifact_id": artifact_id, "artifact_kind": artifact_kind,
                "produced_by": produced_by if produced_by is not None else current_run_id(),
                "from_post_ids": json.dumps(from_post_ids or [], default=str),
                "decision": (decision or "")[:1000], "provider": provider, "model": model,
                "ts": _utc_now(),
            }).last_pk

        return _retry_on_locked(_ins)
    except Exception:
        return -1


# ── Academic Mode — research-brief persistence ───────────────────────────────

def record_academic_brief(*, topic: str, run_id: str, level: str,
                          gate_status: str, grounded_count: int,
                          stages: list[dict] | None = None, markdown: str = "",
                          fmt: str = "markdown", export_path: str | None = None,
                          limitations: str = "", citations: list[str] | None = None,
                          generated_at: str = "", review_decision: str = "",
                          integrity_verdict: str = "", citations_verified: int = 0) -> int:
    """Upsert one finalized academic brief. Best-effort, -1 on failure, never raises."""
    try:
        db = get_db()

        def _ins() -> int:
            return db["academic_briefs"].upsert({
                "run_id": run_id, "topic": topic, "level": level,
                "gate_status": gate_status, "grounded_count": int(grounded_count or 0),
                "stages_json": json.dumps(stages or [], default=str),
                "markdown": markdown or "", "fmt": fmt or "markdown",
                "export_path": export_path or "", "limitations": limitations or "",
                "citations_json": json.dumps(citations or [], default=str),
                "generated_at": generated_at or _utc_now(),
                "review_decision": review_decision or "",
                "integrity_verdict": integrity_verdict or "",
                "citations_verified": int(citations_verified or 0),
            }, pk="run_id").last_pk

        return _retry_on_locked(_ins)
    except Exception:
        return -1


def get_academic_brief(topic: str) -> dict:
    """Return the latest academic brief for ``topic`` (UI reader). Hydrates the
    JSON columns. Returns {ok: False} when none exists."""
    try:
        db = get_db()
        rows = list(db.query(
            "SELECT * FROM academic_briefs WHERE topic = ? "
            "ORDER BY generated_at DESC LIMIT 1",
            [topic],
        ))
        if not rows:
            return {"ok": False, "topic": topic, "reason": "no_brief"}
        row = rows[0]
        for col, key in (("stages_json", "stages"), ("citations_json", "citations")):
            try:
                row[key] = json.loads(row.pop(col) or ("[]"))
            except Exception:
                row[key] = []
        row["ok"] = True
        return row
    except Exception as e:
        return {"ok": False, "topic": topic, "reason": str(e)[:200]}


# ── FSD Fleet — debate persistence ───────────────────────────────────────────

def record_debate_run(*, topic: str, run_id: str, rounds: int,
                      personas_used: list[str] | None = None,
                      status: str = "running", cost_tokens: int = 0,
                      provider: str = "", model: str = "") -> int:
    """Open a debate_runs row. Best-effort — returns row id or -1, never raises."""
    try:
        db = get_db()

        def _ins() -> int:
            return db["debate_runs"].insert({
                "topic": topic, "run_id": run_id, "rounds": int(rounds or 0),
                "personas_used_json": json.dumps(personas_used or [], default=str),
                "status": status, "cost_tokens": int(cost_tokens or 0),
                "provider": provider, "model": model,
                "started_at": _utc_now(), "finished_at": "",
            }).last_pk

        return _retry_on_locked(_ins)
    except Exception:
        return -1


def finish_debate_run(run_id: str, *, status: str = "done",
                      cost_tokens: int = 0,
                      transcript: list | None = None,
                      counts: dict | None = None) -> None:
    """Close a debate_runs row by run_id, persisting the audit transcript +
    tier counts for the Phase 3 replay timeline. Best-effort, never raises."""
    try:
        db = get_db()
        t_json = json.dumps(transcript or [], default=str)
        c_json = json.dumps(counts or {}, default=str)

        def _upd() -> None:
            db.execute(
                "UPDATE debate_runs SET status = ?, cost_tokens = ?, finished_at = ?, "
                "transcript_json = ?, counts_json = ? WHERE run_id = ?",
                [status, int(cost_tokens or 0), _utc_now(), t_json, c_json, run_id],
            )
            db.conn.commit()  # raw execute() does not auto-commit; persist cross-process

        _retry_on_locked(_upd)
    except Exception:
        pass


def debate_audit_for_topic(topic: str) -> dict:
    """Phase 3 — replay/audit payload for a topic's latest debate: run header,
    per-round per-persona transcript, tier counts, and provenance gate counts
    from checks_ledger + lineage. Never raises."""
    out = {"ok": True, "topic": topic, "run": None, "transcript": [],
           "counts": {}, "checks": 0, "lineage": 0}
    try:
        db = get_db()
        if "debate_runs" not in db.table_names():
            return out
        runs = list(db.query(
            "SELECT * FROM debate_runs WHERE topic = ? ORDER BY id DESC LIMIT 1",
            [topic],
        ))
        if not runs:
            return out
        run = runs[0]
        try:
            transcript = json.loads(run.get("transcript_json") or "[]")
        except Exception:
            transcript = []
        try:
            counts = json.loads(run.get("counts_json") or "{}")
        except Exception:
            counts = {}
        out["run"] = {
            "run_id": run.get("run_id"), "rounds": run.get("rounds"),
            "status": run.get("status"), "provider": run.get("provider"),
            "model": run.get("model"), "started_at": run.get("started_at"),
            "finished_at": run.get("finished_at"), "cost_tokens": run.get("cost_tokens"),
        }
        out["transcript"] = transcript
        out["counts"] = counts
        rid = run.get("run_id")
        if "checks_ledger" in db.table_names():
            r = list(db.query(
                "SELECT COUNT(*) c FROM checks_ledger WHERE topic = ? AND run_id = ?",
                [topic, rid]))
            out["checks"] = (r[0]["c"] if r else 0)
        if "lineage" in db.table_names():
            r = list(db.query(
                "SELECT COUNT(*) c FROM lineage WHERE topic = ? AND artifact_kind = 'debate_verdict'",
                [topic]))
            out["lineage"] = (r[0]["c"] if r else 0)
        return out
    except Exception:
        return out


def record_debate_verdict(*, topic: str, target_kind: str, target_id: str,
                          tier: str, consensus_score: float,
                          dissent: list[dict] | None = None,
                          evidence_post_ids: list[str] | None = None,
                          findings_hash: str = "", run_id: str = "",
                          provenance: str = "debated", provider: str = "",
                          model: str = "") -> int:
    """Insert one debate verdict. Best-effort — returns row id or -1, never raises."""
    try:
        db = get_db()

        def _ins() -> int:
            return db["debate_verdicts"].insert({
                "topic": topic, "target_kind": target_kind, "target_id": target_id,
                "tier": tier, "consensus_score": float(consensus_score or 0.0),
                "dissent_json": json.dumps(dissent or [], default=str),
                "evidence_post_ids_json": json.dumps(evidence_post_ids or [], default=str),
                "transcript_ref": run_id, "findings_hash": findings_hash,
                "provenance": provenance, "run_id": run_id,
                "provider": provider, "model": model, "created_at": _utc_now(),
            }).last_pk

        return _retry_on_locked(_ins)
    except Exception:
        return -1


def clear_debate_verdicts(topic: str) -> None:
    """Delete prior verdicts for a topic before a fresh debate. Never raises."""
    try:
        db = get_db()
        if "debate_verdicts" not in db.table_names():
            return

        def _del() -> None:
            db.execute("DELETE FROM debate_verdicts WHERE topic = ?", [topic])
            db.conn.commit()

        _retry_on_locked(_del)
    except Exception:
        pass


def set_node_debate_cache(topic: str, node_id: str, *, tier: str,
                          score: float) -> None:
    """Refresh the denormalized debate columns on a graph_nodes row. Never raises."""
    try:
        db = get_db()
        if "graph_nodes" not in db.table_names():
            return

        def _upd() -> None:
            db.execute(
                "UPDATE graph_nodes SET debate_tier = ?, consensus_score = ?, "
                "debated_at = ? WHERE id = ? AND topic = ?",
                [tier, float(score or 0.0), _utc_now(), node_id, topic],
            )
            db.conn.commit()  # raw execute() does not auto-commit; persist cross-process

        _retry_on_locked(_upd)
    except Exception:
        pass


def debate_verdicts_for_topic(topic: str, *, current_hash: str = "") -> dict:
    """Read all verdicts for a topic plus the latest run summary.

    Returns `{verdicts, runs_latest, stale, findings_hash}`. `stale` is True
    when `current_hash` is provided and differs from the stored verdict hash
    (i.e. the findings changed since the last debate). Never raises."""
    out = {"verdicts": [], "runs_latest": None, "stale": False, "findings_hash": ""}
    try:
        db = get_db()
        if "debate_verdicts" not in db.table_names():
            return out
        rows = list(db.query(
            "SELECT * FROM debate_verdicts WHERE topic = ? ORDER BY consensus_score DESC",
            [topic],
        ))
        verdicts: list[dict] = []
        stored_hash = ""
        for r in rows:
            stored_hash = r.get("findings_hash") or stored_hash
            try:
                dissent = json.loads(r.get("dissent_json") or "[]")
            except Exception:
                dissent = []
            try:
                posts = json.loads(r.get("evidence_post_ids_json") or "[]")
            except Exception:
                posts = []
            verdicts.append({
                "target_kind": r.get("target_kind"),
                "target_id": r.get("target_id"),
                "tier": r.get("tier"),
                "consensus_score": r.get("consensus_score"),
                "dissent": dissent,
                "evidence_post_ids": posts,
                "evidence_count": len(posts),
                "provenance": r.get("provenance"),
                "run_id": r.get("run_id"),
                "created_at": r.get("created_at"),
            })
        out["verdicts"] = verdicts
        out["findings_hash"] = stored_hash
        if current_hash and stored_hash:
            out["stale"] = (current_hash != stored_hash)
        if "debate_runs" in db.table_names():
            runs = list(db.query(
                "SELECT * FROM debate_runs WHERE topic = ? ORDER BY id DESC LIMIT 1",
                [topic],
            ))
            if runs:
                out["runs_latest"] = runs[0]
        return out
    except Exception:
        return out


# ── FSD Fleet — flow-run persistence ─────────────────────────────────────────

def record_fleet_run(*, topic: str, run_id: str, route: str, mode: str,
                     signals: dict | None = None) -> int:
    """Open a fleet_runs row (status 'running'). Returns row id or -1, never raises."""
    try:
        db = get_db()

        def _ins() -> int:
            return db["fleet_runs"].insert({
                "topic": topic, "run_id": run_id, "route": route, "mode": mode,
                "status": "running", "stages_json": "[]",
                "signals_json": json.dumps(signals or {}, default=str),
                "cost_tokens": 0, "started_at": _utc_now(), "finished_at": "",
            }).last_pk

        return _retry_on_locked(_ins)
    except Exception:
        return -1


def finish_fleet_run(run_id: str, *, status: str = "done",
                     stages: list | None = None, cost_tokens: int = 0) -> None:
    """Close a fleet_runs row with its stage timeline + cost. Never raises."""
    try:
        db = get_db()
        s_json = json.dumps(stages or [], default=str)

        def _upd() -> None:
            db.execute(
                "UPDATE fleet_runs SET status = ?, stages_json = ?, cost_tokens = ?, "
                "finished_at = ? WHERE run_id = ?",
                [status, s_json, int(cost_tokens or 0), _utc_now(), run_id],
            )
            db.conn.commit()  # raw execute() does not auto-commit

        _retry_on_locked(_upd)
    except Exception:
        pass


def fleet_status_for_topic(topic: str) -> dict:
    """Latest fleet run for a topic, parsed. `{run: None}` when none. Never raises."""
    out = {"ok": True, "topic": topic, "run": None}
    try:
        db = get_db()
        if "fleet_runs" not in db.table_names():
            return out
        rows = list(db.query(
            "SELECT * FROM fleet_runs WHERE topic = ? ORDER BY id DESC LIMIT 1", [topic]))
        if not rows:
            return out
        r = rows[0]
        try:
            stages = json.loads(r.get("stages_json") or "[]")
        except Exception:
            stages = []
        try:
            signals = json.loads(r.get("signals_json") or "{}")
        except Exception:
            signals = {}
        out["run"] = {
            "run_id": r.get("run_id"), "route": r.get("route"), "mode": r.get("mode"),
            "status": r.get("status"), "stages": stages, "signals": signals,
            "cost_tokens": r.get("cost_tokens"),
            "started_at": r.get("started_at"), "finished_at": r.get("finished_at"),
        }
        return out
    except Exception:
        return out


# ── Upserts ──────────────────────────────────────────────────────────────────

def upsert_posts(rows: Iterable[dict[str, Any]]) -> int:
    rows = list(rows)
    if not rows:
        return 0
    _retry_on_locked(get_db()["posts"].upsert_all, rows, pk="id")
    # Keep the semantic-search palace in sync, best-effort. Strict gates:
    #   1. OPENREPLY_SKIP_PALACE=1 → always skip (CI / tests / minimal deploys)
    #   2. retrieval extras missing → skip silently
    #   3. ONNX model not cached yet → skip silently. Critical: without
    #      this gate, the FIRST collect after install triggers 6 parallel
    #      download attempts (one per source worker) for the 79 MB ONNX
    #      file — they race, corrupt each other, and dump tqdm progress
    #      bars into the collect log. The palace is opt-in — user must
    #      click Enable in Settings → Semantic search (single serialized
    #      warmup), then a Reindex backfills the existing corpus.
    if os.getenv("OPENREPLY_SKIP_PALACE") in ("1", "true", "yes"):
        return len(rows)
    # Chroma Rust bindings are unstable from worker threads in our collect
    # fanout path. Keep SQLite writes parallel, but defer vector upserts to
    # main-thread flows (reindex / enrich / explicit retrieval jobs).
    if threading.current_thread() is not threading.main_thread():
        return len(rows)
    try:
        from ..retrieval.palace import is_available, is_model_ready, upsert_posts_many
        # is_model_ready() also probes for the bundled / on-disk tar and
        # seeds it into the Chroma cache automatically — so a fresh MCP
        # process sees True the moment ChromaDB is ready to extract on
        # first embed. Callers that fetched-then-MCP-restarted will pick
        # the index up too.
        if is_available() and is_model_ready():
            with _palace_upsert_lock:
                upsert_posts_many(rows)
    except Exception:
        pass
    return len(rows)


def upsert_comments(rows: Iterable[dict[str, Any]]) -> int:
    rows = list(rows)
    if not rows:
        return 0
    _retry_on_locked(get_db()["comments"].upsert_all, rows, pk="id")
    return len(rows)


def upsert_users(rows: Iterable[dict[str, Any]]) -> int:
    rows = list(rows)
    if not rows:
        return 0
    get_db()["users"].upsert_all(rows, pk="name")
    return len(rows)


def upsert_subreddit(row: dict[str, Any]) -> None:
    get_db()["subreddits"].upsert(row, pk="name")


def save_mcp_analysis(
    *,
    topic: str,
    kind: str,
    tool: str,
    content: str,
    source: str = "mcp",
    content_type: str = "markdown",
    params: dict[str, Any] | None = None,
    provider: str = "",
    model: str = "",
    tokens_in: int = 0,
    tokens_out: int = 0,
) -> int:
    """Record one LLM-driven analysis row for the unified GUI surface.

    Returns the inserted row id. Safe to call from any thread that went
    through get_db() — each thread has its own connection.
    """
    row = {
        "topic": topic or "",
        "kind": kind,
        "source": source,
        "tool": tool,
        "params_json": json.dumps(params, sort_keys=True) if params else "",
        "content": content,
        "content_type": content_type,
        "provider": provider,
        "model": model,
        "tokens_in": int(tokens_in or 0),
        "tokens_out": int(tokens_out or 0),
        "created_at": _utc_now(),
    }
    return get_db()["mcp_analyses"].insert(row).last_pk  # type: ignore[return-value]


# ── User-added RSS feeds ─────────────────────────────────────────────────────
# Stored in the shared openreply.db so the Python sidecar (collect) and the desktop
# Settings UI (via the `feeds` CLI subcommand) agree on one source of truth.

def list_user_feeds(enabled_only: bool = False) -> list[dict]:
    """User-added RSS feeds, newest first. enabled_only → active feeds only."""
    db = get_db()
    if "user_feeds" not in db.table_names():
        return []
    where = " WHERE enabled = 1" if enabled_only else ""
    rows = db.execute(
        f"SELECT url, name, enabled, added_at FROM user_feeds{where} "
        "ORDER BY added_at DESC"
    ).fetchall()
    return [
        {"url": r[0], "name": r[1], "enabled": bool(r[2]), "added_at": r[3]}
        for r in rows
    ]


def add_user_feed(url: str, name: str = "") -> dict:
    """Upsert a user feed (enabled). Returns the stored row. Caller should
    validate the URL is a real feed first (see sources.rss.validate_feed)."""
    url = (url or "").strip()
    if not url:
        raise ValueError("url is required")
    db = get_db()
    if "user_feeds" not in db.table_names():
        init_schema(db)  # cold DB / table added after this process's schema init
    row = {"url": url, "name": (name or "").strip() or url,
           "enabled": 1, "added_at": _utc_now()}
    db["user_feeds"].upsert(row, pk="url")
    return {**row, "enabled": True}


def remove_user_feed(url: str) -> bool:
    db = get_db()
    if "user_feeds" not in db.table_names():
        return False
    try:
        db["user_feeds"].delete((url or "").strip())
        return True
    except Exception:
        return False


def set_user_feed_enabled(url: str, enabled: bool) -> bool:
    db = get_db()
    if "user_feeds" not in db.table_names():
        return False
    try:
        db["user_feeds"].update((url or "").strip(), {"enabled": 1 if enabled else 0})
        return True
    except Exception:
        return False


__all__ = [
    "get_db",
    "init_schema",
    "log_fetch_start",
    "log_fetch_end",
    "record_check",
    "record_lineage",
    "record_academic_brief",
    "get_academic_brief",
    "record_debate_run",
    "finish_debate_run",
    "record_debate_verdict",
    "clear_debate_verdicts",
    "set_node_debate_cache",
    "debate_verdicts_for_topic",
    "debate_audit_for_topic",
    "record_fleet_run",
    "finish_fleet_run",
    "fleet_status_for_topic",
    "upsert_posts",
    "upsert_comments",
    "upsert_users",
    "upsert_subreddit",
    "save_mcp_analysis",
    "list_user_feeds",
    "add_user_feed",
    "remove_user_feed",
    "set_user_feed_enabled",
]
