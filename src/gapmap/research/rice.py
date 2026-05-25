"""RICE prioritization (Sean McBride / Intercom, 2016).

    score = (Reach * Impact * Confidence) / Effort

We compute three of the four axes deterministically from data we already
collect; Effort defaults to 3 (medium) until the user overrides it. All
axes can be replaced with user input via :func:`set_rice`.

    Reach       = mention_count of the painpoint that the intervention
                  addresses (number of users we have evidence for).
    Impact      = 1 / 2 / 3 from severity hints in the painpoint metadata
                  (anxiety wording + emotion intensity). Defaults to 2.
    Confidence  = 50% / 80% / 100% based on evidence quality:
                  • 100% — meta-analysis or peer-reviewed paper supports it
                  • 80%  — anecdotal evidence from ≥3 distinct sources
                  • 50%  — single-source / no science backing
    Effort      = 1..13 user-supplied story points. Default 3.

The result is persisted to ``graph_nodes.metadata_json.rice`` for the
intervention, so the Solutions tab and OST tree can read it without
re-running this pass.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from ..core.db import get_db, init_schema, save_mcp_analysis


# ── Heuristics ────────────────────────────────────────────────────────────

_HIGH_IMPACT_TERMS = (
    "unbearable", "extreme", "blocked", "blocking", "loss", "give up",
    "quit", "abandon", "broken", "critical", "crippling", "cannot",
    "impossible", "ruined",
)
_LOW_IMPACT_TERMS = (
    "minor", "slight", "annoy", "annoying", "trivial", "small", "rare",
    "occasionally",
)


def _impact_from_meta(meta: dict[str, Any]) -> int:
    """Map painpoint metadata to a 1/2/3 impact score."""
    why = meta.get("why") or {}
    jtbd = why.get("jtbd") or {}
    blob = " ".join([
        str(meta.get("severity") or ""),
        str(jtbd.get("anxiety") or ""),
        " ".join(why.get("emotions") or []),
    ]).lower()
    if any(t in blob for t in _HIGH_IMPACT_TERMS):
        return 3
    if any(t in blob for t in _LOW_IMPACT_TERMS):
        return 1
    return 2


def _confidence_from_papers(db, intervention_id: str) -> int:
    """Confidence percentage from supporting evidence."""
    if "graph_edges" not in db.table_names() or "graph_nodes" not in db.table_names():
        return 50
    rows = list(db.query(
        """
        SELECT p.metadata_json
        FROM graph_edges e
        JOIN graph_nodes p ON p.id = e.dst AND p.kind = 'evidence_paper'
        WHERE e.src = :iid AND e.kind = 'supported_by'
        """,
        {"iid": intervention_id},
    ))
    if not rows:
        return 50
    tiers = []
    for r in rows:
        try:
            m = json.loads(r.get("metadata_json") or "{}") or {}
        except (json.JSONDecodeError, TypeError):
            m = {}
        t = (m.get("tier") or "").strip().lower()
        if t:
            tiers.append(t)
    if any(t in ("meta-analysis", "peer-reviewed") for t in tiers):
        return 100
    if len(tiers) >= 3:
        return 80
    return 50


# ── Pipeline ──────────────────────────────────────────────────────────────

def score_topic(
    topic: str,
    default_effort: int = 3,
    overwrite_effort: bool = False,
) -> dict[str, Any]:
    """Compute and persist RICE for every intervention in the topic.

    Returns a counts summary. Idempotent — re-running overwrites the
    ``rice`` field but preserves any user-supplied Effort unless
    overwrite_effort=True.
    """
    db = get_db()
    init_schema(db)
    summary: dict[str, Any] = {
        "topic": topic,
        "interventions_scored": 0,
        "skipped": 0,
    }
    if "graph_nodes" not in db.table_names():
        return summary

    has_evidence_col = False
    try:
        has_evidence_col = "evidence_count" in {
            c.name for c in db["graph_nodes"].columns
        }
    except Exception:
        has_evidence_col = False

    sql = (
        "SELECT id, label, metadata_json, COALESCE(evidence_count, 0) AS reach "
        "FROM graph_nodes WHERE topic = :t AND kind = 'painpoint'"
        if has_evidence_col else
        "SELECT id, label, metadata_json, 0 AS reach "
        "FROM graph_nodes WHERE topic = :t AND kind = 'painpoint'"
    )
    pps = list(db.query(sql, {"t": topic}))
    for pp in pps:
        try:
            pp_meta = json.loads(pp.get("metadata_json") or "{}") or {}
        except (json.JSONDecodeError, TypeError):
            pp_meta = {}
        reach = max(int(pp.get("reach") or 0), 0)
        impact = _impact_from_meta(pp_meta)

        intvs = list(db.query(
            """
            SELECT iv.id, iv.metadata_json
            FROM graph_edges e1
            JOIN graph_nodes m  ON m.id = e1.dst AND m.kind = 'mechanism'
            JOIN graph_edges e2 ON e2.src = m.id AND e2.kind = 'addressed_by'
            JOIN graph_nodes iv ON iv.id = e2.dst AND iv.kind = 'intervention'
            WHERE e1.src = :pid AND e1.kind = 'explained_by'
            """,
            {"pid": pp["id"]},
        ))
        if not intvs:
            summary["skipped"] += 1
            continue

        for iv in intvs:
            try:
                meta = json.loads(iv.get("metadata_json") or "{}") or {}
            except (json.JSONDecodeError, TypeError):
                meta = {}
            confidence = _confidence_from_papers(db, iv["id"])
            existing = meta.get("rice") or {}
            effort = (
                int(existing.get("effort") or 0)
                if not overwrite_effort and existing.get("effort")
                else int(default_effort or 3)
            )
            effort = max(1, min(int(effort), 13))
            score = (reach * impact * (confidence / 100.0)) / effort
            meta["rice"] = {
                "reach": reach,
                "impact": impact,
                "confidence": confidence,
                "effort": effort,
                "score": round(score, 2),
                "auto": True,
            }
            db["graph_nodes"].update(iv["id"], {"metadata_json": json.dumps(meta)})
            summary["interventions_scored"] += 1

    try:
        save_mcp_analysis(
            topic=topic, source="app", kind="rice",
            tool="run_rice_score",
            content=json.dumps(summary, ensure_ascii=False),
            content_type="json", provider="", model="", params={},
        )
    except Exception:
        pass
    return summary


def set_rice(
    intervention_id: str,
    *,
    reach: Optional[int] = None,
    impact: Optional[int] = None,
    confidence: Optional[int] = None,
    effort: Optional[int] = None,
) -> dict[str, Any]:
    """User-override RICE values for one intervention."""
    db = get_db()
    if "graph_nodes" not in db.table_names():
        return {"ok": False, "error": "graph_nodes table missing"}
    row = db["graph_nodes"].get(intervention_id)
    if not row:
        return {"ok": False, "error": f"intervention '{intervention_id}' not found"}
    try:
        meta = json.loads(row.get("metadata_json") or "{}") or {}
    except (json.JSONDecodeError, TypeError):
        meta = {}
    rice = dict(meta.get("rice") or {})
    if reach is not None:
        rice["reach"] = max(int(reach), 0)
    if impact is not None:
        rice["impact"] = max(1, min(int(impact), 3))
    if confidence is not None:
        rice["confidence"] = max(0, min(int(confidence), 100))
    if effort is not None:
        rice["effort"] = max(1, min(int(effort), 13))
    rice.setdefault("reach", 0)
    rice.setdefault("impact", 2)
    rice.setdefault("confidence", 50)
    rice.setdefault("effort", 3)
    rice["score"] = round(
        (rice["reach"] * rice["impact"] * (rice["confidence"] / 100.0))
        / max(rice["effort"], 1),
        2,
    )
    rice["auto"] = False
    meta["rice"] = rice
    db["graph_nodes"].update(intervention_id, {"metadata_json": json.dumps(meta)})
    return {"ok": True, "intervention_id": intervention_id, "rice": rice}


__all__ = ["score_topic", "set_rice"]
