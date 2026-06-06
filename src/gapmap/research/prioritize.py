"""Ranked opportunity list — the "which gap do I pursue?" view.

Every intervention (a candidate solution to a painpoint, stored as a
`graph_nodes` row with kind='intervention') can be scored by RICE
(Reach·Impact·Confidence ÷ Effort), classified by Kano (basic / performance /
delighter), and bucketed by MoSCoW (must / should / could / wont). Those
scores are persisted on `graph_nodes.metadata_json` by the rice/kano/moscow
modules. This module reads them back, joins each intervention to the painpoint
it addresses (via graph_edges), and returns one ranked table sorted by RICE.

Pure read — never raises; returns an empty list if the graph isn't built yet.
"""
from __future__ import annotations

import json
from typing import Any

from ..core.db import get_db


def _painpoint_by_intervention(db, topic: str) -> dict[str, str]:
    """Map intervention node id → the painpoint label it addresses, via edges."""
    out: dict[str, str] = {}
    if "graph_edges" not in db.table_names() or "graph_nodes" not in db.table_names():
        return out
    try:
        rows = db.query(
            """
            SELECT e.src AS src, e.dst AS dst,
                   ns.label AS src_label, ns.kind AS src_kind,
                   nd.label AS dst_label, nd.kind AS dst_kind
            FROM graph_edges e
            JOIN graph_nodes ns ON ns.id = e.src
            JOIN graph_nodes nd ON nd.id = e.dst
            WHERE e.topic = :t
            """,
            {"t": topic},
        )
        for r in rows:
            # Edge may point either direction; pick the painpoint end for the
            # intervention end.
            if r.get("src_kind") == "intervention" and r.get("dst_kind") == "painpoint":
                out.setdefault(r["src"], r.get("dst_label") or "")
            elif r.get("dst_kind") == "intervention" and r.get("src_kind") == "painpoint":
                out.setdefault(r["dst"], r.get("src_label") or "")
    except Exception:
        return out
    return out


def prioritize_topic(topic: str, limit: int = 200) -> dict[str, Any]:
    """Return the topic's interventions ranked by RICE, with Kano/MoSCoW tags
    and the painpoint each addresses. Unscored interventions sort last."""
    db = get_db()
    if "graph_nodes" not in db.table_names():
        return {"topic": topic, "opportunities": [], "scored": 0, "total": 0}

    rows = list(db.query(
        """
        SELECT id, label, metadata_json
        FROM graph_nodes
        WHERE topic = :t AND kind = 'intervention'
          AND label IS NOT NULL AND label != ''
        ORDER BY created_at DESC
        """,
        {"t": topic},
    ))
    pain_by_iv = _painpoint_by_intervention(db, topic)

    out: list[dict[str, Any]] = []
    scored = 0
    for r in rows:
        try:
            meta = json.loads(r.get("metadata_json") or "{}") or {}
        except Exception:
            meta = {}
        rice = meta.get("rice") if isinstance(meta.get("rice"), dict) else {}
        score = rice.get("score")
        if score is not None:
            scored += 1
        out.append({
            "id": r.get("id"),
            "label": r.get("label"),
            "rice_score": score,
            "reach": rice.get("reach"),
            "impact": rice.get("impact"),
            "confidence": rice.get("confidence"),
            "effort": rice.get("effort"),
            "kano": meta.get("kano"),
            "moscow": meta.get("moscow"),
            "painpoint": pain_by_iv.get(r.get("id")) or None,
        })

    # RICE desc, None last; then alphabetical for stable order.
    out.sort(key=lambda x: (x["rice_score"] is None, -(x["rice_score"] or 0), (x["label"] or "").lower()))
    return {
        "topic": topic,
        "opportunities": out[:limit],
        "scored": scored,
        "total": len(out),
    }
