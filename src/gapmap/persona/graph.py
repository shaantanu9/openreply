"""Persona knowledge graph — per-persona ChromaDB collection + cosine edges.

Phase 2a (2026-05-12). Each persona gets its own collection under the
existing ChromaDB store so we share the same on-disk dir + embedding
function (configurable via ``GAPMAP_EMBEDDING_MODEL``). After every new
memory we:

1. Embed the lesson and ``add()`` it to the collection.
2. Query the same collection for top-K most-similar prior memories.
3. Write ``persona_edges`` rows with ``kind='relates_to'`` and
   ``weight = 1 - distance`` (Chroma returns distance, we store similarity).
4. Cap edges per memory at ``MAX_EDGES_PER_MEMORY`` to keep the graph
   readable on the UI side and avoid an O(N²) hairball at scale.

ChromaDB is optional. When unavailable, every entrypoint is a no-op so
the rest of the persona pipeline keeps working — just without a graph.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db

logger = logging.getLogger(__name__)

MAX_EDGES_PER_MEMORY = 5
MIN_EDGE_SIMILARITY = 0.45
_COLL_PREFIX = "persona_memories_"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _coll_name(persona_id: int) -> str:
    return f"{_COLL_PREFIX}{int(persona_id)}"


def _get_collection(persona_id: int):
    """Return the per-persona Chroma collection, or None if ChromaDB is
    unavailable / failed to initialise. Reuses the palace client so we
    don't open a second SQLite/HNSW handle."""
    try:
        from ..retrieval import palace  # noqa
    except Exception:
        return None
    if not palace.is_available():
        return None
    try:
        got = palace.get_palace()
        if got is None:
            return None
        client, _posts = got
        kwargs: dict[str, Any] = {"metadata": {"hnsw:space": "cosine"}}
        try:
            from ..retrieval.embedder import get_embedding_function
            ef = get_embedding_function()
            if ef is not None:
                kwargs["embedding_function"] = ef
        except Exception:
            pass
        return client.get_or_create_collection(_coll_name(persona_id), **kwargs)
    except Exception as e:
        logger.warning("persona graph: get_collection failed: %s", e)
        return None


def is_available() -> bool:
    """True iff the chromadb stack is importable and a palace client opens."""
    try:
        from ..retrieval import palace
    except Exception:
        return False
    return palace.is_available()


# ── core ops ────────────────────────────────────────────────────────────────

def embed_memory(persona_id: int, memory_id: int, lesson: str) -> bool:
    """Add (or replace) one memory in the persona's collection. Returns True
    on success, False on any failure (logged)."""
    coll = _get_collection(persona_id)
    if coll is None or not (lesson or "").strip():
        return False
    try:
        # ``upsert`` so re-running ingest on the same memory_id doesn't dup.
        coll.upsert(
            ids=[str(memory_id)],
            documents=[lesson],
            metadatas=[{"memory_id": int(memory_id), "persona_id": int(persona_id)}],
        )
        return True
    except Exception as e:
        logger.warning("persona graph: embed_memory(p=%s, m=%s) failed: %s",
                       persona_id, memory_id, e)
        return False


def build_edges_for_memory(
    persona_id: int,
    memory_id: int,
    *,
    top_k: int = MAX_EDGES_PER_MEMORY,
    min_sim: float = MIN_EDGE_SIMILARITY,
) -> int:
    """Find top-K similar prior memories and write edges. Skips self.
    Returns the number of edges written."""
    coll = _get_collection(persona_id)
    if coll is None:
        return 0
    try:
        # Query by the memory's own document. n_results=top_k+1 because the
        # first hit is ALWAYS the memory itself (distance 0).
        res = coll.query(
            query_texts=None,
            query_embeddings=None,
            ids=[str(memory_id)],
            n_results=int(top_k) + 1,
        ) if False else None  # query-by-id is awkward; use document lookup
        # Fetch the doc, then query by document.
        got = coll.get(ids=[str(memory_id)], include=["documents"])
        docs = (got or {}).get("documents") or []
        if not docs:
            return 0
        doc = docs[0]
        if not doc:
            return 0
        res = coll.query(
            query_texts=[doc],
            n_results=int(top_k) + 1,
            include=["distances", "metadatas"],
        )
    except Exception as e:
        logger.warning("persona graph: query failed (p=%s, m=%s): %s",
                       persona_id, memory_id, e)
        return 0

    ids = (res.get("ids") or [[]])[0]
    dists = (res.get("distances") or [[]])[0]
    if not ids:
        return 0

    db = get_db()
    now = _now()
    written = 0
    for other_id_s, dist in zip(ids, dists):
        try:
            other_id = int(other_id_s)
        except (TypeError, ValueError):
            continue
        if other_id == memory_id:
            continue
        sim = 1.0 - float(dist or 0.0)
        if sim < min_sim:
            continue
        # Idempotency: upsert by (persona_id, from, to) pair (undirected,
        # so canonicalise so from < to to avoid duplicating both directions).
        fid, tid = (memory_id, other_id) if memory_id < other_id else (other_id, memory_id)
        existing = db.execute(
            "SELECT id FROM persona_edges WHERE persona_id = ? AND "
            "from_memory_id = ? AND to_memory_id = ?",
            [persona_id, fid, tid],
        ).fetchone()
        if existing:
            # Keep the highest seen similarity
            db.execute(
                "UPDATE persona_edges SET weight = MAX(weight, ?) WHERE id = ?",
                [sim, existing[0]],
            )
            continue
        db["persona_edges"].insert({
            "persona_id": persona_id,
            "from_memory_id": fid,
            "to_memory_id": tid,
            "kind": "relates_to",
            "weight": sim,
            "created_at": now,
        })
        written += 1
        if written >= top_k:
            break
    return written


def embed_and_link(persona_id: int, memory_id: int, lesson: str) -> int:
    """Convenience: embed + build edges. Called from the ingest pipeline.
    Returns the number of new edges written (0 on any failure)."""
    if not embed_memory(persona_id, memory_id, lesson):
        return 0
    return build_edges_for_memory(persona_id, memory_id)


# ── backfill / recompute ────────────────────────────────────────────────────

def backfill_persona(persona_id: int) -> dict:
    """Embed every memory that isn't already in the collection, then
    rebuild edges from scratch. Useful after enabling chromadb on an
    install that already has memories from a no-chroma run."""
    coll = _get_collection(persona_id)
    if coll is None:
        return {"ok": False, "error": "chromadb_unavailable"}

    db = get_db()
    cur = db.execute(
        "SELECT id, lesson FROM persona_memories WHERE persona_id = ? "
        "AND COALESCE(lesson, '') != ''",
        [persona_id],
    )
    rows = cur.fetchall()

    # Compute the set of already-embedded ids by doing a get(ids=) batched.
    embedded = 0
    skipped = 0
    try:
        existing_ids = set(
            (coll.get(ids=[str(r[0]) for r in rows]) or {}).get("ids") or []
        )
    except Exception:
        existing_ids = set()
    for mid, lesson in rows:
        if str(mid) in existing_ids:
            skipped += 1
            continue
        if embed_memory(persona_id, mid, lesson):
            embedded += 1

    # Rebuild edges from scratch.
    db.execute("DELETE FROM persona_edges WHERE persona_id = ?", [persona_id])
    edges = 0
    for mid, _lesson in rows:
        edges += build_edges_for_memory(persona_id, mid)

    return {
        "ok": True,
        "persona_id": persona_id,
        "memories_total": len(rows),
        "embeddings_added": embedded,
        "embeddings_skipped": skipped,
        "edges_written": edges,
    }


# ── readers (for UI / chat) ─────────────────────────────────────────────────

def neighbors(persona_id: int, memory_ids: list[int], *, limit: int = 4) -> list[dict]:
    """1-hop graph expansion: return memories edge-linked to ``memory_ids`` but
    not already in that seed set, strongest edge first. Used by the reply blend
    to pull "related knowledge" around the directly-retrieved memories.
    """
    import json as _json

    if not memory_ids:
        return []
    db = get_db()
    seed = {int(m) for m in memory_ids}
    qmarks = ",".join("?" * len(seed))
    cur = db.execute(
        f"SELECT from_memory_id, to_memory_id, weight FROM persona_edges "
        f"WHERE persona_id = ? "
        f"AND (from_memory_id IN ({qmarks}) OR to_memory_id IN ({qmarks})) "
        f"ORDER BY weight DESC",
        [persona_id, *seed, *seed],
    )
    neigh_ids: list[int] = []
    for a, b, _w in cur.fetchall():
        for x in (int(a), int(b)):
            if x not in seed and x not in neigh_ids:
                neigh_ids.append(x)
        if len(neigh_ids) >= limit:
            break
    neigh_ids = neigh_ids[:limit]
    if not neigh_ids:
        return []
    qm = ",".join("?" * len(neigh_ids))
    cur = db.execute(
        f"SELECT id, source_post_id, topic, lesson, excerpt, tags, importance, created_at "
        f"FROM persona_memories WHERE id IN ({qm})",
        neigh_ids,
    )
    cols = [c[0] for c in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    order = {mid: i for i, mid in enumerate(neigh_ids)}
    rows.sort(key=lambda r: order.get(r["id"], 999))
    for r in rows:
        try:
            r["tags"] = _json.loads(r.get("tags") or "[]")
        except (TypeError, ValueError):
            r["tags"] = []
    return rows


def list_edges(persona_id: int, *, limit: int = 500) -> list[dict]:
    db = get_db()
    cur = db.execute(
        "SELECT id, persona_id, from_memory_id, to_memory_id, kind, weight, created_at "
        "FROM persona_edges WHERE persona_id = ? "
        "ORDER BY weight DESC LIMIT ?",
        [persona_id, int(limit)],
    )
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def graph_payload(persona_id: int, *, edge_limit: int = 500) -> dict:
    """Return {nodes, edges} formatted for a JS force-directed renderer."""
    db = get_db()
    edges = list_edges(persona_id, limit=edge_limit)
    mem_ids: set[int] = set()
    for e in edges:
        mem_ids.add(e["from_memory_id"])
        mem_ids.add(e["to_memory_id"])
    if not mem_ids:
        # Solo memories with no edges yet — still show as nodes
        cur = db.execute(
            "SELECT id FROM persona_memories WHERE persona_id = ? "
            "ORDER BY created_at DESC LIMIT 50",
            [persona_id],
        )
        mem_ids.update(int(r[0]) for r in cur.fetchall())
    if not mem_ids:
        return {"nodes": [], "edges": []}
    qmarks = ",".join("?" * len(mem_ids))
    cur = db.execute(
        f"SELECT id, lesson, topic, importance, created_at "
        f"FROM persona_memories WHERE id IN ({qmarks})",
        list(mem_ids),
    )
    cols = [c[0] for c in cur.description]
    nodes = [dict(zip(cols, r)) for r in cur.fetchall()]
    return {"nodes": nodes, "edges": edges}
