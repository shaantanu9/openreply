"""Opportunity Solution Tree (Teresa Torres, 2016).

Aggregates the data the rest of Gap Map already produces into the four
canonical OST layers:

    Outcome  →  Opportunities  →  Solutions  →  Experiments
    (product) → (painpoints)    → (interventions) → (experiments)

Reads only — no LLM calls, no schema migrations. The whole tree is one
SQL pass plus per-node metadata enrichment, so the Tauri command stays
under 1s for normal corpora.

Public API:
    build_tree(topic, product_id=None) -> dict
        Returns the JSON-serialisable tree the UI consumes. If a
        product_id is passed, the outcome is read from products.outcome
        (column added by _ensure_lifecycle_schema). Otherwise the outcome
        is the topic name as a placeholder.

    set_outcome(product_id, outcome) -> dict
        Writes the desired-outcome string to products.outcome.

    create_experiment(topic, *, painpoint_id, intervention_id, hypothesis,
                      method, success_criteria, sample_size) -> dict
    list_experiments(topic, *, painpoint_id=None) -> list[dict]
    update_experiment(experiment_id, fields) -> dict
    delete_experiment(experiment_id) -> dict
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from ..core.db import get_db, init_schema


VALID_EXPERIMENT_METHODS = (
    "fake_door", "landing_page", "wizard_of_oz", "concierge", "survey", "custom",
)
VALID_EXPERIMENT_STATUSES = (
    "planned", "running", "validated", "invalidated", "inconclusive",
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _safe_meta(raw: Any) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        return json.loads(raw) or {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "node"


# ── Outcome (root) ────────────────────────────────────────────────────────
def set_outcome(product_id: str, outcome: str) -> dict[str, Any]:
    """Persist the OST root outcome onto the product row."""
    db = get_db()
    init_schema(db)
    if "products" not in db.table_names():
        return {"ok": False, "error": "products table missing"}
    rows = list(db.query("SELECT id FROM products WHERE id = ?", [product_id]))
    if not rows:
        return {"ok": False, "error": f"product '{product_id}' not found"}
    db["products"].upsert(
        {"id": product_id, "outcome": (outcome or "").strip()[:500]},
        pk="id",
    )
    return {"ok": True, "product_id": product_id, "outcome": outcome}


def _resolve_outcome(db, topic: str, product_id: Optional[str]) -> str:
    """Pick the outcome to display at the OST root."""
    if product_id and "products" in db.table_names():
        rows = list(db.query(
            "SELECT outcome, name FROM products WHERE id = ?",
            [product_id],
        ))
        if rows:
            cur = (rows[0].get("outcome") or "").strip()
            if cur:
                return cur
            name = (rows[0].get("name") or "").strip()
            if name:
                return f"Improve {name}"
    return f"Address user pain in {topic}"


# ── Tree builder ──────────────────────────────────────────────────────────
def build_tree(topic: str, product_id: Optional[str] = None) -> dict[str, Any]:
    """Walk the four OST layers and return a UI-ready dict.

    Shape:
        {
          ok: True,
          topic, product_id,
          outcome: "...",
          opportunities: [
            {
              id, label,                  # painpoint
              mention_count, severity,     # quick triage signal
              jtbd_statement, emotions,
              solutions: [
                {
                  id, label,               # intervention
                  kano, moscow, rice,      # priority chips
                  effort, confidence_tier, rationale,
                  experiments: [...],
                  mechanism: "..."
                }
              ],
            }
          ],
          orphan_experiments: [...],     # experiments with no intervention
        }
    """
    db = get_db()
    init_schema(db)

    out = {
        "ok": True,
        "topic": topic,
        "product_id": product_id or "",
        "outcome": _resolve_outcome(db, topic, product_id),
        "opportunities": [],
        "orphan_experiments": [],
    }
    if "graph_nodes" not in db.table_names():
        return out

    # `evidence_count` is the canonical mention-count column on a fully
    # migrated install. Older databases lack the column entirely — sqlite
    # raises `no such column` rather than treating it as NULL, so we
    # check existence first and fall back to a graph_edges count.
    has_evidence_col = False
    try:
        has_evidence_col = "evidence_count" in {
            c.name for c in db["graph_nodes"].columns
        }
    except Exception:
        has_evidence_col = False

    if has_evidence_col:
        pps = list(db.query(
            """
            SELECT id, label, metadata_json,
                   COALESCE(evidence_count, 0) AS evidence_count
            FROM graph_nodes
            WHERE topic = :t AND kind = 'painpoint'
            ORDER BY COALESCE(evidence_count, 0) DESC, label
            """,
            {"t": topic},
        ))
    else:
        pps = list(db.query(
            """
            SELECT id, label, metadata_json, 0 AS evidence_count
            FROM graph_nodes
            WHERE topic = :t AND kind = 'painpoint'
            ORDER BY label
            """,
            {"t": topic},
        ))

    # Pre-fetch all interventions + their mechanisms in one pass.
    intv_rows = list(db.query(
        """
        SELECT pp.id AS painpoint_id,
               m.id AS mechanism_id, m.label AS mechanism_label,
               iv.id AS intervention_id, iv.label AS intervention_label,
               iv.metadata_json AS intervention_meta
        FROM graph_nodes pp
        JOIN graph_edges e1 ON e1.src = pp.id AND e1.kind = 'explained_by'
        JOIN graph_nodes m  ON m.id = e1.dst AND m.kind = 'mechanism'
        JOIN graph_edges e2 ON e2.src = m.id AND e2.kind = 'addressed_by'
        JOIN graph_nodes iv ON iv.id = e2.dst AND iv.kind = 'intervention'
        WHERE pp.topic = :t AND pp.kind = 'painpoint'
        """,
        {"t": topic},
    ))
    intv_by_pp: dict[str, list[dict]] = {}
    for r in intv_rows:
        intv_by_pp.setdefault(r["painpoint_id"], []).append(r)

    # Pre-fetch experiments by painpoint AND by intervention.
    exp_by_intv: dict[str, list[dict]] = {}
    exp_orphan_by_pp: dict[str, list[dict]] = {}
    if "ost_experiments" in db.table_names():
        for r in db.query(
            "SELECT * FROM ost_experiments WHERE topic = ? ORDER BY created_at",
            [topic],
        ):
            iid = (r.get("intervention_id") or "").strip()
            pid = (r.get("painpoint_id") or "").strip()
            if iid:
                exp_by_intv.setdefault(iid, []).append(r)
            elif pid:
                exp_orphan_by_pp.setdefault(pid, []).append(r)
            else:
                out["orphan_experiments"].append(r)

    for pp in pps:
        meta = _safe_meta(pp.get("metadata_json"))
        why = meta.get("why") or {}
        jtbd = why.get("jtbd") or {}
        opp = {
            "id": pp["id"],
            "label": pp["label"],
            "mention_count": int(pp.get("evidence_count") or 0),
            "severity": meta.get("severity") or jtbd.get("anxiety") or "",
            "jtbd_statement": (why.get("jtbd_statement") or "").strip(),
            "desired_outcome": jtbd.get("desired_outcome", ""),
            "emotions": list(why.get("emotions") or []),
            "solutions": [],
            "orphan_experiments": exp_orphan_by_pp.get(pp["id"], []),
        }

        for r in intv_by_pp.get(pp["id"], []):
            iv_meta = _safe_meta(r.get("intervention_meta"))
            opp["solutions"].append({
                "id": r["intervention_id"],
                "label": r["intervention_label"],
                "mechanism": r.get("mechanism_label") or "",
                "kano": iv_meta.get("kano") or "",
                "kano_confidence": iv_meta.get("kano_confidence") or "",
                "moscow": iv_meta.get("moscow") or "",
                "rice": iv_meta.get("rice") or None,
                "effort": iv_meta.get("effort") or "",
                "confidence_tier": iv_meta.get("confidence_tier") or "",
                "rationale": iv_meta.get("rationale") or "",
                "experiments": exp_by_intv.get(r["intervention_id"], []),
            })

        # Stable sort: highest RICE first, then must_be > performance > attractive.
        kano_order = {"must_be": 0, "performance": 1, "attractive": 2,
                      "indifferent": 3, "reverse": 4, "": 5}
        moscow_order = {"must": 0, "should": 1, "could": 2, "wont": 3, "": 4}

        def _sort_key(s: dict) -> tuple:
            rice = s.get("rice") or {}
            score = float(rice.get("score") or 0.0)
            return (
                -score,
                kano_order.get(s.get("kano", ""), 5),
                moscow_order.get(s.get("moscow", ""), 4),
                s.get("label", ""),
            )

        opp["solutions"].sort(key=_sort_key)
        out["opportunities"].append(opp)

    return out


# ── Experiments CRUD ──────────────────────────────────────────────────────
def create_experiment(
    topic: str,
    *,
    painpoint_id: str,
    intervention_id: str = "",
    hypothesis: str,
    method: str = "custom",
    success_criteria: str = "",
    sample_size: int = 0,
) -> dict[str, Any]:
    db = get_db()
    init_schema(db)
    method = (method or "custom").strip().lower()
    if method not in VALID_EXPERIMENT_METHODS:
        return {
            "ok": False,
            "error": f"invalid method '{method}' — expected one of "
                     f"{', '.join(VALID_EXPERIMENT_METHODS)}",
        }
    if not (hypothesis or "").strip():
        return {"ok": False, "error": "hypothesis is required"}

    eid = f"exp_{uuid.uuid4().hex[:10]}"
    now = _utc_now()
    row = {
        "id": eid,
        "topic": topic,
        "painpoint_id": painpoint_id or "",
        "intervention_id": intervention_id or "",
        "hypothesis": hypothesis.strip()[:1000],
        "method": method,
        "success_criteria": (success_criteria or "").strip()[:1000],
        "sample_size": int(sample_size or 0),
        "status": "planned",
        "result_notes": "",
        "created_at": now,
        "updated_at": now,
    }
    db["ost_experiments"].insert(row)
    return {"ok": True, "experiment": row}


def list_experiments(
    topic: str,
    painpoint_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    db = get_db()
    if "ost_experiments" not in db.table_names():
        return []
    if painpoint_id:
        return list(db.query(
            "SELECT * FROM ost_experiments WHERE topic = ? AND painpoint_id = ? "
            "ORDER BY created_at DESC",
            [topic, painpoint_id],
        ))
    return list(db.query(
        "SELECT * FROM ost_experiments WHERE topic = ? ORDER BY created_at DESC",
        [topic],
    ))


def update_experiment(
    experiment_id: str,
    fields: dict[str, Any],
) -> dict[str, Any]:
    db = get_db()
    if "ost_experiments" not in db.table_names():
        return {"ok": False, "error": "ost_experiments table missing"}
    rows = list(db.query(
        "SELECT id FROM ost_experiments WHERE id = ?", [experiment_id]
    ))
    if not rows:
        return {"ok": False, "error": f"experiment '{experiment_id}' not found"}
    allowed = {
        "hypothesis", "method", "success_criteria", "sample_size",
        "status", "result_notes",
    }
    patch = {k: v for k, v in (fields or {}).items() if k in allowed}
    if "method" in patch:
        m = (patch["method"] or "").strip().lower()
        if m not in VALID_EXPERIMENT_METHODS:
            return {"ok": False, "error": f"invalid method '{m}'"}
        patch["method"] = m
    if "status" in patch:
        s = (patch["status"] or "").strip().lower()
        if s not in VALID_EXPERIMENT_STATUSES:
            return {"ok": False, "error": f"invalid status '{s}'"}
        patch["status"] = s
    if "sample_size" in patch:
        try:
            patch["sample_size"] = int(patch["sample_size"] or 0)
        except (TypeError, ValueError):
            patch["sample_size"] = 0
    if not patch:
        return {"ok": False, "error": "no valid fields to update"}
    patch["id"] = experiment_id
    patch["updated_at"] = _utc_now()
    db["ost_experiments"].upsert(patch, pk="id")
    return {"ok": True, "experiment_id": experiment_id, "patch": patch}


def delete_experiment(experiment_id: str) -> dict[str, Any]:
    db = get_db()
    if "ost_experiments" not in db.table_names():
        return {"ok": False, "error": "ost_experiments table missing"}
    db.execute("DELETE FROM ost_experiments WHERE id = ?", [experiment_id])
    try:
        db.conn.commit()
    except Exception:
        pass
    return {"ok": True, "experiment_id": experiment_id, "deleted": True}


__all__ = [
    "VALID_EXPERIMENT_METHODS",
    "VALID_EXPERIMENT_STATUSES",
    "build_tree",
    "set_outcome",
    "create_experiment",
    "list_experiments",
    "update_experiment",
    "delete_experiment",
]
