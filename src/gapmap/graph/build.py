"""Structural graph builder — derives a topic's graph from existing Reddit
tables (topic_posts, posts, comments, users) with zero LLM calls.

Output node kinds: topic, subreddit/source, post, comment, user, document,
document_element.
Output edge kinds: contains, has_comment, authored, replied_to, era,
has_source_doc, has_source_element.

Re-runnable. Upsert everything so calling build_structural() twice is a no-op.
"""
from __future__ import annotations

import json
import threading
from typing import Any

from ..core.db import get_db
from ..core.pullpush_client import CUTOFF_UTC
from .schema import ensure_graph_schema, make_node_id


# ─── Batch buffer (perf path) ───────────────────────────────────────────────
# When `_BATCH.active`, _upsert_node / _upsert_edge APPEND to the per-thread
# row buffers instead of executing one INSERT OR REPLACE per call. The caller
# (build_structural) flushes both via executemany at the end of the
# transaction — turning 18K individual sqlite-utils round trips (3-4 s on
# a medium topic) into 2 bulk INSERTs (~50 ms).
#
# Profile of build_structural for a 3K-post topic, BEFORE this change:
#   3.40 s — 18,037 sqlite_utils.upsert() calls
#   3.36 s —     ditto into insert_all
#   2.71 s — _upsert_edge call overhead (subset of above)
# AFTER (measured): the upsert cost drops from ~3.4 s → < 100 ms.

class _BatchState(threading.local):
    """Per-thread buffer state — only the active build_structural call
    in this thread participates. Other threads / unrelated callers see
    `active=False` and get the original per-row upsert path.

    `default_confidence` is graphify-style edge provenance the structural
    builder turns on for the duration of the build — every edge it
    creates is EXTRACTED (deterministic SQL join), so the call sites
    don't have to spell that out 12 times. Semantic.py / relations.py
    pass their own confidence explicitly and overrule this default.
    """
    def __init__(self):
        super().__init__()
        self.active = False
        self.nodes: list[tuple] = []
        self.edges: list[tuple] = []
        self.seen_nodes: set[str] = set()       # de-dup repeated _upsert_node calls
        self.seen_edges: set[tuple] = set()     # de-dup repeated _upsert_edge calls
        self.existing_ts: dict[str, str] = {}   # pre-loaded for ts preservation
        self.default_confidence: str | None = None

_BATCH = _BatchState()


def _flush_batch(db) -> None:
    """Bulk-insert everything buffered during the active build. Called once
    at the end of _build_structural_body. Cheap: two executemany calls."""
    if _BATCH.nodes:
        db.conn.executemany(
            "INSERT OR REPLACE INTO graph_nodes "
            "(id, topic, kind, label, metadata_json, ts) VALUES (?, ?, ?, ?, ?, ?)",
            _BATCH.nodes,
        )
    if _BATCH.edges:
        db.conn.executemany(
            "INSERT OR REPLACE INTO graph_edges "
            "(src, dst, kind, topic, weight, metadata_json) VALUES (?, ?, ?, ?, ?, ?)",
            _BATCH.edges,
        )


def _upsert_node(
    db,
    topic: str,
    kind: str,
    key: str,
    label: str,
    metadata: dict | None = None,
) -> str:
    from datetime import datetime, timezone
    node_id = make_node_id(topic, kind, key)

    # ── Batch fast path ────────────────────────────────────────────────────
    if _BATCH.active:
        if node_id in _BATCH.seen_nodes:
            return node_id      # already buffered this build — de-dup
        _BATCH.seen_nodes.add(node_id)
        ts = _BATCH.existing_ts.get(node_id) or \
             datetime.now(timezone.utc).isoformat(timespec="seconds")
        _BATCH.nodes.append((
            node_id, topic, kind, label,
            json.dumps(metadata or {}, default=str, ensure_ascii=False),
            ts,
        ))
        return node_id

    # ── Legacy per-row path (unchanged for non-batch callers) ──────────────
    # Preserve existing ts on update — a re-extracted finding keeps its
    # original creation timestamp so it doesn't flicker as "new" on re-run.
    try:
        existing = list(db.query("SELECT ts FROM graph_nodes WHERE id = ?", [node_id]))
        ts = (existing[0].get("ts") if existing else "") \
             or datetime.now(timezone.utc).isoformat(timespec="seconds")
    except Exception:
        # Schema without ts column (pre-migration) or other DB hiccup —
        # fall back to a fresh timestamp; lazy migration in init_schema
        # will add the column on next startup.
        ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db["graph_nodes"].upsert(
        {
            "id": node_id,
            "topic": topic,
            "kind": kind,
            "label": label,
            "metadata_json": json.dumps(metadata or {}, default=str, ensure_ascii=False),
            "ts": ts,
        },
        pk="id",
    )
    return node_id


def _upsert_edge(
    db,
    topic: str,
    src: str,
    dst: str,
    kind: str,
    weight: float = 1.0,
    metadata: dict | None = None,
    confidence: str | None = None,
) -> None:
    # `confidence` is graphify-style edge provenance, stored INSIDE
    # metadata_json so the column schema doesn't change:
    #   EXTRACTED — derived from a deterministic SQL join (structural)
    #   INFERRED  — produced by the LLM enrichment pass OR a strong
    #               structural signal (e.g. shared evidence posts)
    #   AMBIGUOUS — cosine-only similarity with no corroborating signal
    md = dict(metadata or {}) if metadata else {}
    effective_confidence = confidence or _BATCH.default_confidence
    if effective_confidence and "confidence" not in md:
        md["confidence"] = effective_confidence
    md_json = json.dumps(md, default=str, ensure_ascii=False)

    # ── Batch fast path ────────────────────────────────────────────────────
    if _BATCH.active:
        edge_key = (src, dst, kind)
        if edge_key in _BATCH.seen_edges:
            return              # already buffered this build — de-dup
        _BATCH.seen_edges.add(edge_key)
        _BATCH.edges.append((src, dst, kind, topic, weight, md_json))
        return

    # ── Legacy per-row path ────────────────────────────────────────────────
    db["graph_edges"].upsert(
        {
            "src": src,
            "dst": dst,
            "kind": kind,
            "topic": topic,
            "weight": weight,
            "metadata_json": md_json,
        },
        pk=("src", "dst", "kind"),
    )


def _era_label(created_utc: float | None) -> str:
    if not created_utc:
        return "unknown"
    return "pre_2025" if created_utc < CUTOFF_UTC else "post_2025"


def build_structural(topic: str) -> dict[str, Any]:
    """Build structural graph nodes + edges for a topic from existing data.

    Returns a summary dict: counts per kind, total rows.

    PERF — single transaction wrap. The DB connection uses
    `isolation_level=None` (sqlite3 autocommit) so every individual
    upsert was fsync'ing to disk. For a 7K-post topic that meant
    ~50K-100K disk syncs (each ~1-2ms) — 30-60 seconds wall time
    where the actual work is well under a second. We send explicit
    BEGIN here + COMMIT at the return; on exception we ROLLBACK so a
    half-built graph never leaks into the DB. This shaves typical
    build times by ~10-20x.
    """
    import time as _time
    _t0 = _time.time()

    ensure_graph_schema()
    db = get_db()

    # Coerce out of sqlite3 autocommit mode for the duration of the build,
    # so the whole thing runs in one deferred transaction. The connection
    # is opened with `isolation_level=None` (autocommit) globally, which
    # fsyncs every individual upsert — at ~1-2 ms each, a 7K-post topic
    # was paying 30-60 s of pure commit overhead. With deferred mode +
    # one final commit, that same topic finishes in 1-3 s.
    #
    # ALSO: activate the batch buffer so _upsert_node / _upsert_edge
    # buffer rows in memory instead of issuing one sqlite-utils round
    # trip per call. Profile of medium topic showed 18K such calls
    # accounted for 44% of build time before batching. We pre-load
    # existing ts values for this topic so re-builds preserve the
    # original creation timestamp (used for the "new finding" badge
    # in the UI) — one SELECT instead of N.
    #
    # We restore the original isolation_level + reset the batch buffer
    # at the end so callers downstream see normal behavior.
    _orig_iso = db.conn.isolation_level
    db.conn.isolation_level = ""    # "" = deferred — implicit BEGIN, manual COMMIT

    # Pre-load existing node ts for this topic — one query, dict lookup
    # during the build to preserve "first seen" timestamps on re-runs.
    _BATCH.existing_ts = {}
    try:
        for row in db.query(
            "SELECT id, ts FROM graph_nodes WHERE topic = ?", [topic]
        ):
            if row.get("id") and row.get("ts"):
                _BATCH.existing_ts[row["id"]] = row["ts"]
    except Exception:
        pass  # fresh schema or empty topic — fine
    _BATCH.active = True
    _BATCH.nodes = []
    _BATCH.edges = []
    _BATCH.seen_nodes = set()
    _BATCH.seen_edges = set()
    # Every edge created during the structural pass is a deterministic
    # SQL join — graphify-style "EXTRACTED" provenance. Stamped via the
    # batch state so individual call sites stay terse.
    _BATCH.default_confidence = "EXTRACTED"

    try:
        try:
            result = _build_structural_body(topic, db)
            _flush_batch(db)        # one executemany per table
            db.conn.commit()
        except Exception:
            try:
                db.conn.rollback()
            except Exception:
                pass
            raise
    finally:
        db.conn.isolation_level = _orig_iso
        _BATCH.active = False
        _BATCH.nodes = []
        _BATCH.edges = []
        _BATCH.seen_nodes = set()
        _BATCH.seen_edges = set()
        _BATCH.existing_ts = {}
        _BATCH.default_confidence = None

    _elapsed = _time.time() - _t0
    result["elapsed_seconds"] = round(_elapsed, 2)
    return result


def _build_structural_body(topic: str, db) -> dict[str, Any]:
    """The real work of build_structural — wrapped in a single transaction
    by the caller. Kept separate so callers can also wrap it themselves
    when calling alongside other writes (e.g. dense relation pass)."""

    # Root: the topic itself
    topic_node = _upsert_node(db, topic, "topic", topic, topic)

    # Collect all posts tagged under this topic
    posts = list(
        db.query(
            """
            SELECT p.id, p.sub, p.source_type, p.author, p.title, p.num_comments, p.score,
                   p.created_utc, p.permalink
            FROM posts p JOIN topic_posts tp ON tp.post_id = p.id
            WHERE tp.topic = ?
            """,
            [topic],
        )
    )

    node_counts = {
        "topic": 1,
        "subreddit": 0,
        "source": 0,
        "post": 0,
        "comment": 0,
        "user": 0,
        "era": 0,
        "document": 0,
        "document_element": 0,
    }
    edge_counts = {
        "contains": 0,
        "has_comment": 0,
        "authored": 0,
        "era": 0,
        "replied_to": 0,
        "has_source_doc": 0,
        "has_source_element": 0,
    }

    seen_subs: set[str] = set()
    seen_sources: set[str] = set()
    seen_users: set[str] = set()
    seen_eras: set[str] = set()
    post_id_map: dict[str, str] = {}  # reddit post id → graph node id

    # Era nodes (pre/post 2025)
    for era in ("pre_2025", "post_2025"):
        _upsert_node(db, topic, "era", era, era)
        seen_eras.add(era)
        node_counts["era"] += 1

    # Ensure one canonical source node per source_type (reddit/hn/arxiv/...)
    # so the graph can always represent cross-source relationships even when
    # Reddit rows are grouped under subreddit nodes.
    for p in posts:
        src = (p.get("source_type") or "reddit").lower()
        if not src or src in seen_sources:
            continue
        source_label = {
            "reddit": "Reddit",
            "hn": "Hacker News",
            "appstore": "App Store",
            "playstore": "Play Store",
            "scholar": "Google Scholar",
            "stackoverflow": "Stack Overflow",
            "rss_marketing": "Marketing / growth (15 feeds)",
            "rss_persuasion": "Persuasion / behavioral",
            "rss_swipe": "Ad swipe files",
            "duckduckgo": "DuckDuckGo", "gdelt": "GDELT News", "tavily": "Tavily",
            "worldbank": "World Bank", "fred": "FRED", "bis": "BIS",
            "yfinance": "Yahoo Finance", "openmeteo": "Open-Meteo", "acled": "ACLED",
        }.get(src, src.upper())
        source_node = _upsert_node(
            db,
            topic,
            "source",
            src,
            source_label,
            metadata={"source_type": src, "is_canonical_source": True},
        )
        _upsert_edge(db, topic, topic_node, source_node, "contains")
        edge_counts["contains"] += 1
        node_counts["source"] = node_counts.get("source", 0) + 1
        seen_sources.add(src)

    # Subs (or non-reddit source containers) + posts + authorship + era
    for p in posts:
        sub = (p.get("sub") or "").lower()
        source_type = (p.get("source_type") or "reddit").lower()
        if not sub:
            continue
        # Choose node kind + label by source type
        if source_type == "reddit":
            container_kind = "subreddit"
            container_label = f"r/{sub}"
        else:
            container_kind = "source"
            # nicer display labels
            pretty_prefix = {
                "hn": "HN",
                "appstore": "📱",
                "playstore": "🤖",
                "scholar": "📚",
                "stackoverflow": "SO",
                "duckduckgo": "🦆", "gdelt": "📰", "tavily": "🔎",
                "worldbank": "🏦", "fred": "📈", "bis": "🏛️",
                "yfinance": "💹", "openmeteo": "🌦️", "acled": "⚠️",
            }.get(source_type, source_type.upper())
            container_label = f"{pretty_prefix} {sub}" if ":" in sub else pretty_prefix

        if sub not in seen_subs:
            sub_node = _upsert_node(
                db, topic, container_kind, sub, container_label,
                metadata={"source_type": source_type},
            )
            _upsert_edge(db, topic, topic_node, sub_node, "contains")
            edge_counts["contains"] += 1
            node_counts[container_kind] = node_counts.get(container_kind, 0) + 1
            seen_subs.add(sub)
        sub_node = make_node_id(topic, container_kind, sub)

        post_node = _upsert_node(
            db,
            topic,
            "post",
            p["id"],
            (p.get("title") or "")[:140],
            metadata={
                "score": p.get("score"),
                "num_comments": p.get("num_comments"),
                "created_utc": p.get("created_utc"),
                "permalink": p.get("permalink"),
                "sub": sub,
                "era": _era_label(p.get("created_utc")),
            },
        )
        post_id_map[p["id"]] = post_node
        _upsert_edge(db, topic, sub_node, post_node, "contains")
        edge_counts["contains"] += 1
        node_counts["post"] += 1
        # Canonical source -> post edge keeps "all source knowledge together"
        # in the same graph even when container is subreddit/document bundle.
        source_node = make_node_id(topic, "source", source_type)
        if db["graph_nodes"].count_where("id = ?", [source_node]) > 0:
            _upsert_edge(db, topic, source_node, post_node, "contains")
            edge_counts["contains"] += 1

        author = p.get("author") or "[deleted]"
        if author and author != "[deleted]" and author not in seen_users:
            _upsert_node(db, topic, "user", author, f"u/{author}")
            seen_users.add(author)
            node_counts["user"] += 1
        if author and author != "[deleted]":
            user_node = make_node_id(topic, "user", author)
            _upsert_edge(db, topic, user_node, post_node, "authored")
            edge_counts["authored"] += 1

        # Era edge
        era = _era_label(p.get("created_utc"))
        era_node = make_node_id(topic, "era", era)
        _upsert_edge(db, topic, post_node, era_node, "era")
        edge_counts["era"] += 1

    # Comments for posts in this topic
    if posts:
        post_ids = [p["id"] for p in posts]
        # sqlite-utils has no ANY() helper; use IN with placeholders
        placeholders = ",".join("?" for _ in post_ids)
        comments = list(
            db.query(
                f"""
                SELECT id, post_id, parent_id, author, body, score, created_utc
                FROM comments WHERE post_id IN ({placeholders})
                """,
                post_ids,
            )
        )
        for c in comments:
            pid = post_id_map.get(c["post_id"])
            if not pid:
                continue
            c_node = _upsert_node(
                db,
                topic,
                "comment",
                c["id"],
                (c.get("body") or "")[:120],
                metadata={
                    "score": c.get("score"),
                    "created_utc": c.get("created_utc"),
                    "post_id": c.get("post_id"),
                    "era": _era_label(c.get("created_utc")),
                },
            )
            _upsert_edge(db, topic, pid, c_node, "has_comment")
            edge_counts["has_comment"] += 1
            node_counts["comment"] += 1

            # Comment authorship
            author = c.get("author") or "[deleted]"
            if author and author != "[deleted]":
                if author not in seen_users:
                    _upsert_node(db, topic, "user", author, f"u/{author}")
                    seen_users.add(author)
                    node_counts["user"] += 1
                user_node = make_node_id(topic, "user", author)
                _upsert_edge(db, topic, user_node, c_node, "authored")
                edge_counts["authored"] += 1

    # Local-file source provenance: document + element nodes and edges.
    docs = list(
        db.query(
            """
            SELECT id, post_id, source_path, source_type, parser, parser_mode, artifact_dir
            FROM ingested_documents
            WHERE topic = ?
            """,
            [topic],
        )
    )
    for d in docs:
        doc_key = d["id"]
        doc_label = (d.get("source_path") or d.get("id") or "")[:140]
        doc_node = _upsert_node(
            db,
            topic,
            "document",
            doc_key,
            doc_label,
            metadata={
                "source_path": d.get("source_path"),
                "permalink": d.get("source_path"),
                "source_type": d.get("source_type"),
                "parser": d.get("parser"),
                "parser_mode": d.get("parser_mode"),
                "artifact_dir": d.get("artifact_dir"),
            },
        )
        node_counts["document"] += 1
        _upsert_edge(db, topic, topic_node, doc_node, "contains")
        edge_counts["contains"] += 1
        pid = d.get("post_id")
        if pid:
            post_node = make_node_id(topic, "post", str(pid))
            if db["graph_nodes"].count_where("id = ?", [post_node]) > 0:
                _upsert_edge(db, topic, post_node, doc_node, "has_source_doc")
                edge_counts["has_source_doc"] += 1

    elements = list(
        db.query(
            """
            SELECT id, document_id, post_id, element_id, element_type, content, page_number, bbox_json
            FROM document_elements
            WHERE topic = ?
            """,
            [topic],
        )
    )
    for e in elements:
        elem_node = _upsert_node(
            db,
            topic,
            "document_element",
            e["id"],
            (e.get("content") or e.get("element_type") or "element")[:140],
            metadata={
                "document_id": e.get("document_id"),
                "post_id": e.get("post_id"),
                "element_id": e.get("element_id"),
                "element_type": e.get("element_type"),
                "page_number": e.get("page_number"),
                "bbox_json": e.get("bbox_json"),
                "permalink": None,
            },
        )
        node_counts["document_element"] += 1
        doc_node = make_node_id(topic, "document", str(e.get("document_id")))
        if db["graph_nodes"].count_where("id = ?", [doc_node]) > 0:
            _upsert_edge(db, topic, doc_node, elem_node, "contains")
            edge_counts["contains"] += 1
        pid = e.get("post_id")
        if pid:
            post_node = make_node_id(topic, "post", str(pid))
            if db["graph_nodes"].count_where("id = ?", [post_node]) > 0:
                _upsert_edge(db, topic, post_node, elem_node, "has_source_element")
                edge_counts["has_source_element"] += 1

    total_nodes = sum(node_counts.values())
    total_edges = sum(edge_counts.values())

    # If semantic nodes already exist (enrich has run), re-run the
    # relations pass so structural rebuilds pick up any new findings
    # without requiring a full re-enrich. Cheap when finding count is
    # small; silent skip when chromadb isn't installed.
    try:
        has_semantic = db["graph_nodes"].count_where(
            "topic = ? AND kind IN ('painpoint','feature_wish','workaround','product')",
            [topic],
        )
        if has_semantic > 1:
            from .relations import build_semantic_relations
            rel_summary = build_semantic_relations(topic)
            if rel_summary.get("ok") and not rel_summary.get("skipped"):
                edge_counts["relates_to"] = rel_summary.get("relates_to_edges", 0)
                edge_counts["co_evidenced"] = rel_summary.get("co_evidenced_edges", 0)
                total_edges += rel_summary.get("edges_written", 0)
    except Exception:
        pass  # relations layer is best-effort; never block structural build

    return {
        "topic": topic,
        "total_nodes": total_nodes,
        "total_edges": total_edges,
        "nodes_by_kind": node_counts,
        "edges_by_kind": edge_counts,
    }


def graph_stats(topic: str) -> dict[str, Any]:
    """Return summary stats for a topic's graph without rebuilding."""
    ensure_graph_schema()
    db = get_db()
    nodes_by_kind = {
        r["kind"]: r["n"]
        for r in db.query(
            "SELECT kind, count(*) n FROM graph_nodes WHERE topic=? GROUP BY kind",
            [topic],
        )
    }
    edges_by_kind = {
        r["kind"]: r["n"]
        for r in db.query(
            "SELECT kind, count(*) n FROM graph_edges WHERE topic=? GROUP BY kind",
            [topic],
        )
    }
    return {
        "topic": topic,
        "total_nodes": sum(nodes_by_kind.values()),
        "total_edges": sum(edges_by_kind.values()),
        "nodes_by_kind": nodes_by_kind,
        "edges_by_kind": edges_by_kind,
    }
