"""Semantic cross-finding edges — turns a sparse tree graph into a dense
relation graph by connecting findings that share meaning or evidence.

Runs AFTER upsert_semantic() persists all finding nodes. Without this pass
the graph only contains the tree (topic → finding → post) and users see a
hairball of disconnected islands. Every "why doesn't the map form proper
connections?" report traces back here.

Three new edge kinds, all dedup-safe via upsert:

  * `relates_to`        — any two findings with cosine ≥ REL_THRESHOLD
                          (default 0.55). Weight = similarity score.
  * `potentially_solves`— workaround ↔ painpoint with cosine ≥ SOLVE_THRESHOLD
                          (default 0.50). Cross-kind only. Replaces the
                          brittle exact-string `gap` match in upsert_semantic.
  * `could_address`     — feature_wish ↔ painpoint with cosine ≥ 0.50.
  * `co_evidenced`      — two findings that share ≥2 evidence post_ids.
                          Graph structure signal, not semantic — strong on
                          its own even when the labels don't match.

Uses the ChromaDB default embedder (MiniLM ONNX, same as cluster.py). If
chromadb isn't available, returns `{skipped: True}` silently — the tree
edges already there keep the graph functional, just sparse.

Env tunables:
  GAPMAP_REL_THRESHOLD       default 0.55   (relates_to cutoff)
  GAPMAP_SOLVE_THRESHOLD     default 0.50   (potentially_solves / could_address)
  GAPMAP_REL_MAX_NEIGHBORS   default 8      (cap per-node fanout so UI stays readable)
"""
from __future__ import annotations

import logging
import math
import os
import re
from typing import Any, Iterable

from ..core.db import get_db
from .build import _upsert_edge

logger = logging.getLogger(__name__)

# Kinds that are "findings" — worth relating to one another.
_SEMANTIC_KINDS = ("painpoint", "feature_wish", "workaround", "product")
_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = {
    "the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "with",
    "is", "are", "be", "by", "that", "this", "it", "as", "at", "from",
    "app", "apps", "user", "users",
}


def _embeddings_available() -> bool:
    try:
        import chromadb  # noqa: F401
        return True
    except ImportError:
        return False


def _embed(labels: list[str]) -> list[list[float]] | None:
    """Batched call through the shared embedder (default or multilingual)."""
    try:
        from ..retrieval.embedder import get_embedding_function
        fn = get_embedding_function()
        if fn is None:
            return None
        return fn(labels)
    except Exception as e:
        logger.debug("relations: embedding failed: %s", e)
        return None


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1e-9
    nb = math.sqrt(sum(x * x for x in b)) or 1e-9
    return dot / (na * nb)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _token_set(label: str) -> set[str]:
    toks = {t for t in _TOKEN_RE.findall((label or "").lower()) if len(t) >= 3}
    return {t for t in toks if t not in _STOPWORDS}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / max(1, len(a | b))


def _load_semantic_nodes(topic: str) -> list[dict[str, Any]]:
    db = get_db()
    placeholders = ",".join(["?"] * len(_SEMANTIC_KINDS))
    rows = list(db.query(
        f"SELECT id, kind, label FROM graph_nodes "
        f"WHERE topic = ? AND kind IN ({placeholders})",
        [topic, *_SEMANTIC_KINDS],
    ))
    return rows


def _load_evidence_map(topic: str) -> dict[str, set[str]]:
    """finding_id → set of evidence post-node-ids.

    Used by co_evidenced. We intentionally scan `graph_edges.kind` for the
    evidence-style kinds (evidenced_by / wished_in / built_in / about_product)
    that upsert_semantic creates — this stays in sync with any future
    evidence-edge kind added there.
    """
    db = get_db()
    EVIDENCE_KINDS = ("evidenced_by", "wished_in", "built_in", "about_product")
    placeholders = ",".join(["?"] * len(EVIDENCE_KINDS))
    rows = db.query(
        f"SELECT src, dst FROM graph_edges "
        f"WHERE topic = ? AND kind IN ({placeholders})",
        [topic, *EVIDENCE_KINDS],
    )
    out: dict[str, set[str]] = {}
    for r in rows:
        # Only keep edges whose dst is a post node — about_product's dst is
        # a product node which we don't want in the co-evidence buckets.
        if ":post:" in r["dst"]:
            out.setdefault(r["src"], set()).add(r["dst"])
    return out


def _build_relates_to(
    topic: str,
    nodes: list[dict],
    vectors: list[list[float]],
    threshold: float,
    max_neighbors: int,
    evidence_map: dict[str, set[str]] | None = None,
) -> int:
    """Emit `relates_to` edges: any pair with cos ≥ threshold. Weight =
    similarity (float, preserves ordering for downstream viz).

    Also emits `potentially_solves` for workaround↔painpoint and
    `could_address` for feature_wish↔painpoint, lowering the threshold a
    touch since cross-kind pairs are semantically looser than intra-kind.
    """
    if len(nodes) < 2:
        return 0
    db = get_db()
    solve_threshold = _env_float("GAPMAP_SOLVE_THRESHOLD", 0.50)
    lexical_floor = _env_float("GAPMAP_REL_LEXICAL_FLOOR", 0.08)
    bridge_margin = _env_float("GAPMAP_REL_BRIDGE_MARGIN", 0.08)
    evidence_map = evidence_map or {}
    token_sets = [_token_set((n.get("label") or "")) for n in nodes]

    # Per-node neighbor cap — prevents one popular finding from dominating the
    # graph with 30+ edges (creates a hairball instead of surfacing structure).
    # We collect all (score, j) pairs per i, then keep the top-N by score.
    per_node_neighbors: list[list[tuple[float, int]]] = [[] for _ in nodes]
    for i in range(len(nodes)):
        for j in range(i + 1, len(nodes)):
            sim = _cosine(vectors[i], vectors[j])
            if sim >= threshold:
                per_node_neighbors[i].append((sim, j))
                per_node_neighbors[j].append((sim, i))

    # Persist top-N per node. We only write each pair once, tracked in `emitted`.
    emitted: set[tuple[str, str]] = set()
    edges_written = 0
    for i, neighbors in enumerate(per_node_neighbors):
        neighbors.sort(key=lambda t: t[0], reverse=True)
        kept = neighbors[:max_neighbors]
        for sim, j in kept:
            a, b = nodes[i], nodes[j]
            # False-link guard: if two findings share no evidence and no lexical
            # overlap, require a substantially stronger semantic score. This
            # suppresses "meditation app" -> "political corruption" style links
            # from noisy corpora while still allowing strong cross-phrase pairs.
            shared_evidence = len(evidence_map.get(a["id"], set()) & evidence_map.get(b["id"], set()))
            lex_sim = _jaccard(token_sets[i], token_sets[j])
            if shared_evidence == 0 and lex_sim < lexical_floor and sim < (threshold + bridge_margin):
                continue
            # Canonical ordering so (a→b) and (b→a) don't both persist.
            src, dst = (a["id"], b["id"]) if a["id"] < b["id"] else (b["id"], a["id"])
            if (src, dst) in emitted:
                continue
            emitted.add((src, dst))
            _upsert_edge(db, topic, src, dst, "relates_to", weight=float(sim),
                         metadata={
                             "similarity": round(sim, 3),
                             "lexical_overlap": round(lex_sim, 3),
                             "shared_evidence": shared_evidence,
                         })
            edges_written += 1

            # Extra cross-kind edges — stronger semantic claim, so more useful
            # to the UI than generic relates_to. Only emit when sim clears the
            # lower bound; relates_to threshold is typically higher so we may
            # end up with BOTH kinds between the same pair, which is fine —
            # the viz picks one based on kind priority.
            ka, kb = a["kind"], b["kind"]
            pair = {ka, kb}
            if sim >= solve_threshold:
                if pair == {"workaround", "painpoint"}:
                    # src = workaround, dst = painpoint (canonical order for
                    # downstream queries "what does this workaround solve?")
                    wa = a if ka == "workaround" else b
                    pp = a if ka == "painpoint" else b
                    _upsert_edge(db, topic, wa["id"], pp["id"],
                                 "potentially_solves", weight=float(sim),
                                 metadata={"similarity": round(sim, 3)})
                    edges_written += 1
                elif pair == {"feature_wish", "painpoint"}:
                    fw = a if ka == "feature_wish" else b
                    pp = a if ka == "painpoint" else b
                    _upsert_edge(db, topic, fw["id"], pp["id"],
                                 "could_address", weight=float(sim),
                                 metadata={"similarity": round(sim, 3)})
                    edges_written += 1
    return edges_written


def _build_co_evidenced(
    topic: str,
    nodes: list[dict],
    min_shared: int = 2,
) -> int:
    """Findings that share ≥ `min_shared` evidence posts → co_evidenced edge.

    Weight = number of shared posts. Strong structural signal: it means the
    same Reddit thread or paper underpins both claims, independent of label
    similarity. Catches cases where embedding misses (e.g. "latency" and
    "UX feels slow" — different words, same Reddit thread).
    """
    ev_map = _load_evidence_map(topic)
    if len(nodes) < 2 or not ev_map:
        return 0
    db = get_db()
    ids = [n["id"] for n in nodes]
    edges = 0
    # O(n²) pair iteration — fine for typical counts (under a few hundred
    # findings per topic). If this becomes hot, invert the map and bucket
    # by shared post instead.
    for i in range(len(ids)):
        a_id = ids[i]
        a_ev = ev_map.get(a_id)
        if not a_ev:
            continue
        for j in range(i + 1, len(ids)):
            b_id = ids[j]
            b_ev = ev_map.get(b_id)
            if not b_ev:
                continue
            shared = a_ev & b_ev
            if len(shared) < min_shared:
                continue
            src, dst = (a_id, b_id) if a_id < b_id else (b_id, a_id)
            _upsert_edge(db, topic, src, dst, "co_evidenced",
                         weight=float(len(shared)),
                         metadata={"shared_posts": sorted(shared)[:20],
                                   "shared_count": len(shared)})
            edges += 1
    return edges


def build_semantic_relations(topic: str) -> dict[str, Any]:
    """Main entry point. Called at the tail of upsert_semantic() so every
    enrich run produces a well-connected graph, not a hairball of islands.

    Returns a summary dict with counts per new edge kind and `skipped: True`
    if chromadb isn't installed (so the caller can log the hint).
    """
    if not _embeddings_available():
        return {
            "ok": True, "skipped": True,
            "reason": "chromadb not installed — install retrieval extras for dense relations",
        }
    nodes = _load_semantic_nodes(topic)
    if len(nodes) < 2:
        return {"ok": True, "skipped": True, "reason": "fewer than 2 findings to relate"}

    threshold = _env_float("GAPMAP_REL_THRESHOLD", 0.55)
    max_neighbors = _env_int("GAPMAP_REL_MAX_NEIGHBORS", 8)

    # Embed all labels in one pass — ChromaDB's MiniLM ONNX model handles a
    # few hundred items well under a second. We'd hit a problem around 5k+
    # but we're nowhere near that per topic.
    labels = [(n["label"] or "").strip() for n in nodes]
    vectors = _embed(labels)
    if vectors is None:
        return {"ok": True, "skipped": True, "reason": "embedding call failed"}

    evidence_map = _load_evidence_map(topic)
    relates = _build_relates_to(topic, nodes, vectors, threshold, max_neighbors, evidence_map)
    co_ev = _build_co_evidenced(topic, nodes, min_shared=2)

    return {
        "ok": True,
        "topic": topic,
        "finding_count": len(nodes),
        "edges_written": relates + co_ev,
        "relates_to_edges": relates,
        "co_evidenced_edges": co_ev,
        "threshold": threshold,
        "max_neighbors": max_neighbors,
    }


__all__ = ["build_semantic_relations"]
