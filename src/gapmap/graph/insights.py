"""Insight queries — what the eye misses in a force-directed graph.

Three high-value lenses, all pure-read against existing tables (no schema
change, no LLM calls):

  * surprising_connections(topic) — edges whose endpoints sit in DIFFERENT
    communities AND carry high weight / shared evidence. These are the
    "ha, I didn't expect those two to connect" findings that justify the
    whole knowledge graph existing. Requires community_id in node
    metadata_json (run `graph communities` first).

  * knowledge_gaps(topic) — painpoints that have ZERO outgoing
    `could_address` / `potentially_solves` neighbors. These are the
    painpoints with no candidate solution in the corpus → product
    opportunities. Equivalent of graphify's "Knowledge gaps" section
    of GRAPH_REPORT.md.

  * cross_source_bridges(topic) — findings whose evidence spans ≥3
    distinct source kinds (reddit + hn + arxiv, say). Triangulation
    signal: a painpoint repeated across reddit, app store reviews, AND
    a scholar paper is much harder to dismiss than one only seen on
    reddit.

  * god_nodes(topic, kind_filter=...) — top-degree nodes after kind
    filtering. Graphify ranks god nodes by degree alone — for our
    domain we restrict candidates to {painpoint, feature_wish,
    workaround, product} so that subreddit/source mega-hubs don't
    dominate.
"""
from __future__ import annotations

import json
from typing import Any

from ..core.db import get_db


_SEMANTIC_KINDS = ("painpoint", "feature_wish", "workaround", "product")


def _node_community(metadata_json: str | None) -> int | None:
    if not metadata_json:
        return None
    try:
        md = json.loads(metadata_json)
    except Exception:
        return None
    cid = md.get("community_id")
    if isinstance(cid, (int, float)):
        return int(cid)
    return None


def _edge_md(metadata_json: str | None) -> dict[str, Any]:
    if not metadata_json:
        return {}
    try:
        return json.loads(metadata_json) or {}
    except Exception:
        return {}


def surprising_connections(
    topic: str,
    *,
    limit: int = 25,
    edge_kinds: tuple[str, ...] = (
        "relates_to", "co_evidenced", "potentially_solves", "could_address"
    ),
    min_weight: float = 0.0,
) -> list[dict[str, Any]]:
    """Edges that cross community boundaries — the unexpected links.

    Returns up to `limit` edges ranked by weight × (1 if shared_evidence else 0.7).
    The 0.7 penalty for cosine-only edges is the same false-link guard the
    relations builder applies (relations.py:188-195) — keeps the list focused
    on connections that aren't just embedding noise.
    """
    db = get_db()

    # Single round-trip: pull all candidate edges + endpoint community ids
    placeholders = ",".join(["?"] * len(edge_kinds))
    rows = list(db.query(
        f"""
        SELECT e.src, e.dst, e.kind AS edge_kind, e.weight, e.metadata_json AS e_md,
               s.kind AS src_kind, s.label AS src_label, s.metadata_json AS s_md,
               d.kind AS dst_kind, d.label AS dst_label, d.metadata_json AS d_md
        FROM graph_edges e
        JOIN graph_nodes s ON s.id = e.src
        JOIN graph_nodes d ON d.id = e.dst
        WHERE e.topic = ? AND e.kind IN ({placeholders})
              AND e.weight >= ?
        """,
        [topic, *edge_kinds, float(min_weight)],
    ))

    surprises: list[dict[str, Any]] = []
    for r in rows:
        src_cid = _node_community(r.get("s_md"))
        dst_cid = _node_community(r.get("d_md"))
        if src_cid is None or dst_cid is None:
            continue
        if src_cid == dst_cid:
            continue  # within-community = not surprising
        emd = _edge_md(r.get("e_md"))
        weight = float(r.get("weight") or 0.0)
        shared = int(emd.get("shared_evidence") or emd.get("shared_count") or 0)
        confidence = emd.get("confidence")
        # Score: stronger if corroborated by shared evidence.
        score = weight if shared > 0 or confidence == "INFERRED" else weight * 0.7
        surprises.append({
            "src": r["src"], "dst": r["dst"],
            "src_label": r["src_label"], "dst_label": r["dst_label"],
            "src_kind": r["src_kind"], "dst_kind": r["dst_kind"],
            "src_community": src_cid, "dst_community": dst_cid,
            "edge_kind": r["edge_kind"],
            "weight": round(weight, 3),
            "shared_evidence": shared,
            "confidence": confidence,
            "score": round(score, 3),
        })

    surprises.sort(key=lambda x: (-x["score"], -x["weight"]))
    return surprises[:limit]


def knowledge_gaps(
    topic: str,
    *,
    limit: int = 25,
) -> list[dict[str, Any]]:
    """Painpoints with no candidate solver in the graph.

    A painpoint is "gap-confirmed" iff it has ZERO incoming
    `could_address` (from a feature_wish) AND ZERO incoming
    `potentially_solves` (from a workaround) AND no inverse `solves`
    edge from a workaround. These are the product opportunities the
    research surfaced — the corpus shows pain but no one's built
    or proposed a fix.

    Ranked by evidence_count descending so the loudest gaps surface first.
    """
    db = get_db()
    rows = list(db.query(
        """
        SELECT n.id, n.label, n.metadata_json
        FROM graph_nodes n
        WHERE n.topic = ? AND n.kind = 'painpoint'
              AND NOT EXISTS (
                  SELECT 1 FROM graph_edges e
                  WHERE e.topic = n.topic
                    AND e.dst = n.id
                    AND e.kind IN ('could_address','potentially_solves','solves')
              )
        """,
        [topic],
    ))

    out: list[dict[str, Any]] = []
    for r in rows:
        md = _edge_md(r.get("metadata_json"))
        out.append({
            "id": r["id"],
            "label": r["label"],
            "evidence_count": int(md.get("evidence_count") or 0),
            "source_diversity": int(md.get("source_diversity") or 0),
            "severity": md.get("severity"),
            "frequency": md.get("frequency"),
            "classification": md.get("classification"),
            "source_breakdown": md.get("source_breakdown") or {},
        })
    out.sort(key=lambda x: (-x["evidence_count"], -x["source_diversity"]))
    return out[:limit]


def cross_source_bridges(
    topic: str,
    *,
    min_sources: int = 3,
    limit: int = 25,
) -> list[dict[str, Any]]:
    """Findings whose evidence spans ≥ min_sources distinct source kinds.

    Triangulation is the single strongest credibility signal for a
    qualitative finding — when reddit + hn + arxiv all independently
    surface the same pain, it's almost certainly real. Reads
    source_breakdown out of node metadata_json (stamped by
    semantic._link_evidence:91-106) — no fresh SQL aggregation needed.
    """
    db = get_db()
    placeholders = ",".join(["?"] * len(_SEMANTIC_KINDS))
    rows = list(db.query(
        f"""
        SELECT id, kind, label, metadata_json FROM graph_nodes
        WHERE topic = ? AND kind IN ({placeholders})
        """,
        [topic, *_SEMANTIC_KINDS],
    ))

    out: list[dict[str, Any]] = []
    for r in rows:
        md = _edge_md(r.get("metadata_json"))
        sb = md.get("source_breakdown") or {}
        if not isinstance(sb, dict):
            continue
        nonzero = {k: int(v) for k, v in sb.items() if int(v or 0) > 0}
        if len(nonzero) < min_sources:
            continue
        out.append({
            "id": r["id"],
            "kind": r["kind"],
            "label": r["label"],
            "source_diversity": len(nonzero),
            "source_breakdown": nonzero,
            "evidence_count": int(md.get("evidence_count") or sum(nonzero.values())),
            "classification": md.get("classification"),
        })
    out.sort(key=lambda x: (-x["source_diversity"], -x["evidence_count"]))
    return out[:limit]


def god_nodes(
    topic: str,
    *,
    kinds: tuple[str, ...] = _SEMANTIC_KINDS,
    limit: int = 15,
) -> list[dict[str, Any]]:
    """Top-degree nodes within the given kinds — the "god nodes".

    Graphify ranks god nodes by degree alone but in our domain that
    surfaces noisy hubs (subreddit/source). We filter to semantic kinds
    by default so the result is something a human actually wants to read
    (the most-connected painpoint / product / workaround / wish).
    """
    db = get_db()
    placeholders = ",".join(["?"] * len(kinds))
    rows = list(db.query(
        f"""
        SELECT n.id, n.kind, n.label, n.metadata_json,
               (SELECT count(*) FROM graph_edges e
                WHERE e.topic = n.topic AND (e.src = n.id OR e.dst = n.id)) AS degree
        FROM graph_nodes n
        WHERE n.topic = ? AND n.kind IN ({placeholders})
        ORDER BY degree DESC LIMIT ?
        """,
        [topic, *kinds, int(limit)],
    ))
    out = []
    for r in rows:
        md = _edge_md(r.get("metadata_json"))
        out.append({
            "id": r["id"],
            "kind": r["kind"],
            "label": r["label"],
            "degree": int(r.get("degree") or 0),
            "evidence_count": int(md.get("evidence_count") or 0),
            "source_diversity": int(md.get("source_diversity") or 0),
            "community_id": md.get("community_id"),
        })
    return out


# ─── Backfill helpers ──────────────────────────────────────────────────────

# Map each edge kind to its graphify-style confidence. Used by the one-shot
# `graph backfill-confidence` command to retroactively tag rows written
# before edge-confidence stamping landed. Keep in sync with build.py /
# semantic.py / relations.py.
_STRUCTURAL_EDGE_KINDS = {
    "contains", "has_comment", "authored", "replied_to", "era",
    "has_source_doc", "has_source_element",
}
_SEMANTIC_EDGE_KINDS = {
    "has_painpoint", "has_feature_wish", "has_product", "has_workaround",
    "evidenced_by", "wished_in", "about_product", "built_in", "solves",
    "source_evidence", "supports",
    "potentially_solves", "could_address", "co_evidenced",
}


def backfill_edge_confidence(topic: str) -> dict[str, Any]:
    """Apply confidence tags to existing edges that pre-date the stamping logic.

    Idempotent — edges that already carry a `confidence` key in metadata_json
    are left alone. Run once after upgrading the codebase, then rely on the
    inline stamping in build.py / semantic.py / relations.py going forward.

    relates_to edges are a special case: AMBIGUOUS if cosine-only with no
    corroboration, INFERRED otherwise — mirrors the live logic in
    relations.py:188-206.
    """
    db = get_db()
    rows = list(db.query(
        "SELECT src, dst, kind, metadata_json FROM graph_edges WHERE topic = ?",
        [topic],
    ))
    counts = {"EXTRACTED": 0, "INFERRED": 0, "AMBIGUOUS": 0, "skipped_existing": 0}
    for r in rows:
        md = _edge_md(r.get("metadata_json"))
        if md.get("confidence"):
            counts["skipped_existing"] += 1
            continue

        kind = r["kind"]
        if kind in _STRUCTURAL_EDGE_KINDS:
            conf = "EXTRACTED"
        elif kind == "relates_to":
            shared = int(md.get("shared_evidence") or 0)
            lex = float(md.get("lexical_overlap") or 0.0)
            conf = "INFERRED" if (shared > 0 or lex >= 0.08) else "AMBIGUOUS"
        elif kind in _SEMANTIC_EDGE_KINDS:
            conf = "INFERRED"
        else:
            # Unknown edge kind — leave it untagged rather than guess.
            continue

        md["confidence"] = conf
        db.conn.execute(
            """UPDATE graph_edges SET metadata_json = :md
               WHERE src = :s AND dst = :d AND kind = :k AND topic = :t""",
            {"md": json.dumps(md, ensure_ascii=False),
             "s": r["src"], "d": r["dst"], "k": kind, "t": topic},
        )
        counts[conf] += 1
    db.conn.commit()
    return {"topic": topic, **counts}


__all__ = [
    "surprising_connections",
    "knowledge_gaps",
    "cross_source_bridges",
    "god_nodes",
    "backfill_edge_confidence",
]
