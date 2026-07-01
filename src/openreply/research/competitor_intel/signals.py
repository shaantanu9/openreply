"""Findings + opportunities stored in product_signals."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from ...core.db import get_db

FINDING_KINDS = ["complaint", "feature_gap", "churn_trigger", "praise"]
OPPORTUNITY_KIND = "competitor_vulnerability"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(r: dict[str, Any]) -> dict[str, Any]:
    try:
        ev = json.loads(r.get("evidence_post_ids") or "[]")
    except Exception:
        ev = []
    d = dict(r)
    d["evidence_post_ids"] = ev
    return d


def write_signal(
    product_id: str,
    competitor_name: str,
    *,
    signal_type: str,
    title: str,
    description: str = "",
    severity: float = 0.5,
    confidence: float = 0.6,
    evidence_post_ids: list[str] | None = None,
    suggested_action: str = "",
) -> str:
    db = get_db()
    sid = "sig_" + uuid.uuid4().hex[:16]
    db["product_signals"].insert(
        {
            "id": sid,
            "product_id": product_id,
            "signal_type": signal_type,
            "severity": severity,
            "confidence": confidence,
            "detected_at": _now(),
            "title": title,
            "description": description,
            "evidence_post_ids": json.dumps(evidence_post_ids or []),
            "related_competitor": competitor_name,
            "suggested_action": suggested_action,
            "user_action": "",
            "user_action_at": "",
            "snoozed_until": "",
            "resolution_notes": "",
            "created_at": _now(),
        }
    )
    return sid


def list_findings(
    product_id: str, competitor_name: str | None = None, kinds: list[str] | None = None
) -> list[dict[str, Any]]:
    db = get_db()
    where, params = ["product_id = ?"], [product_id]
    if competitor_name:
        where.append("related_competitor = ?")
        params.append(competitor_name)
    ks = kinds or FINDING_KINDS
    where.append("signal_type in (%s)" % ",".join("?" * len(ks)))
    params.extend(ks)
    rows = db["product_signals"].rows_where(
        " and ".join(where), params, order_by="severity desc"
    )
    return [_row(r) for r in rows]


def list_opportunities(
    product_id: str, competitor_name: str | None = None
) -> list[dict[str, Any]]:
    db = get_db()
    where, params = ["product_id = ?", "signal_type = ?"], [product_id, OPPORTUNITY_KIND]
    if competitor_name:
        where.append("related_competitor = ?")
        params.append(competitor_name)
    rows = db["product_signals"].rows_where(
        " and ".join(where), params, order_by="severity desc"
    )
    return [_row(r) for r in rows]


def set_signal_action(signal_id: str, action: str) -> dict[str, Any] | None:
    db = get_db()
    if not list(db["product_signals"].rows_where("id = ?", [signal_id])):
        return None
    db["product_signals"].update(
        signal_id, {"user_action": action, "user_action_at": _now()}
    )
    return _row(next(iter(db["product_signals"].rows_where("id = ?", [signal_id]))))
