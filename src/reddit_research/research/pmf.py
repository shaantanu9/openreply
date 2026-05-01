"""Sean Ellis Product-Market Fit Survey (Ellis, 2010).

Single core question: "How would you feel if you could no longer use
this product?" Threshold: ≥40% answering "Very Disappointed" =
product-market fit. Segment results by persona — total averages can
mask that you have PMF with one segment but not another.

Combine with retention cohort analysis (out of scope here) for the
full Ellis methodology. This module captures responses, computes the
40% PMF score, and slices by persona.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Optional

from ..core.db import get_db, init_schema


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


VALID_DISAPPOINTMENT = (
    "very_disappointed",
    "somewhat_disappointed",
    "not_disappointed",
    "dont_use",
)


def _new_id(topic: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (topic or "").lower()).strip("-") or "pmf"
    return f"{base}-{int(datetime.now().timestamp() * 1000)}"


def add_response(
    topic: str,
    *,
    disappointment: str,
    product_id: str = "",
    respondent: str = "",
    persona: str = "",
    must_have_alternative: str = "",
    main_benefit: str = "",
    ideal_user: str = "",
    improvement: str = "",
    notes: str = "",
    responded_at: str = "",
) -> dict[str, Any]:
    d = (disappointment or "").strip().lower()
    if d not in VALID_DISAPPOINTMENT:
        return {
            "ok": False,
            "error": f"invalid disappointment '{disappointment}', expected one of {VALID_DISAPPOINTMENT}",
        }
    db = get_db()
    init_schema(db)
    rid = _new_id(topic)
    now = _utc_now()
    row = {
        "id": rid,
        "topic": (topic or "").strip(),
        "product_id": (product_id or "").strip(),
        "responded_at": (responded_at or now)[:25],
        "respondent": (respondent or "")[:120],
        "persona": (persona or "")[:80],
        "disappointment": d,
        "must_have_alternative": (must_have_alternative or "")[:300],
        "main_benefit": (main_benefit or "")[:300],
        "ideal_user": (ideal_user or "")[:300],
        "improvement": (improvement or "")[:600],
        "notes": (notes or "")[:600],
        "created_at": now,
    }
    db["pmf_responses"].upsert(row, pk="id")
    return {"ok": True, "response": row}


def delete_response(response_id: str) -> dict[str, Any]:
    db = get_db()
    if "pmf_responses" not in db.table_names():
        return {"ok": False, "error": "pmf_responses table missing"}
    db["pmf_responses"].delete_where("id = ?", [response_id])
    return {"ok": True, "deleted": response_id}


def list_responses(topic: str, product_id: str = "") -> list[dict[str, Any]]:
    db = get_db()
    if "pmf_responses" not in db.table_names():
        return []
    if product_id:
        rows = list(db.query(
            "SELECT * FROM pmf_responses WHERE product_id = ? ORDER BY responded_at DESC",
            [product_id],
        ))
    elif topic:
        rows = list(db.query(
            "SELECT * FROM pmf_responses WHERE topic = ? ORDER BY responded_at DESC",
            [topic],
        ))
    else:
        rows = list(db.query("SELECT * FROM pmf_responses ORDER BY responded_at DESC LIMIT 500"))
    return rows


def score(topic: str, product_id: str = "") -> dict[str, Any]:
    """Compute the Sean Ellis PMF score and per-persona breakdown."""
    rows = list_responses(topic, product_id)
    counts = {k: 0 for k in VALID_DISAPPOINTMENT}
    persona_buckets: dict[str, dict[str, int]] = {}
    for r in rows:
        d = (r.get("disappointment") or "").lower()
        if d in counts:
            counts[d] += 1
        p = (r.get("persona") or "(unspecified)").strip() or "(unspecified)"
        persona_buckets.setdefault(p, {k: 0 for k in VALID_DISAPPOINTMENT})
        if d in persona_buckets[p]:
            persona_buckets[p][d] += 1
    # Exclude "dont_use" from the denominator — Ellis recommends only
    # measuring users who experienced the core value.
    denom = sum(v for k, v in counts.items() if k != "dont_use")
    pct = (counts["very_disappointed"] / denom * 100) if denom else 0.0
    threshold_met = pct >= 40.0

    persona_scores = []
    for p, buckets in persona_buckets.items():
        d = sum(v for k, v in buckets.items() if k != "dont_use")
        ppct = (buckets["very_disappointed"] / d * 100) if d else 0.0
        persona_scores.append({
            "persona": p,
            "n": d,
            "pct_very_disappointed": round(ppct, 1),
            "threshold_met": ppct >= 40.0,
            "counts": buckets,
        })
    persona_scores.sort(key=lambda x: -x["pct_very_disappointed"])

    return {
        "ok": True,
        "topic": topic,
        "n_total": len(rows),
        "n_scored": denom,
        "counts": counts,
        "pct_very_disappointed": round(pct, 1),
        "threshold_met": threshold_met,
        "personas": persona_scores,
    }


__all__ = [
    "add_response", "delete_response", "list_responses", "score",
    "VALID_DISAPPOINTMENT",
]
