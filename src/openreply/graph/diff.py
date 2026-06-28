"""Time-windowed diff of graph findings — 'what's new in the last N days?'

The CHRONIC/EMERGING/FADING classification uses a static May-2025 cutoff,
which tells users whether a painpoint existed before/after a fixed date.
This module answers a different question: "what painpoints appeared for
THIS topic in the last N days vs. the prior window?" — useful for users
running weekly collects who want to spot genuinely new issues.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from ..core.db import get_db


_FINDING_KINDS = ("painpoint", "product", "workaround", "feature_wish")


def _row_to_dict(r: dict) -> dict:
    out = {
        "id": r.get("id"),
        "kind": r.get("kind"),
        "label": r.get("label"),
        "ts": r.get("ts") or "",
    }
    try:
        out["metadata"] = json.loads(r.get("metadata_json") or "{}")
    except Exception:
        out["metadata"] = {}
    return out


def diff_findings(topic: str, window_days: int = 7) -> dict[str, Any]:
    """Split findings for `topic` into recent / prior / stable buckets by ts.

    recent: node created in the last `window_days` days.
    prior:  node created between window_days and 4×window_days days ago.
    stable: older than that, OR has no ts (pre-migration row).

    Returns:
        {
          "topic": str, "window_days": int,
          "recent": list[node_dict], "prior": [...], "stable": [...],
          "summary": {"new_painpoints": int, "new_workarounds": int,
                      "new_products": int, "new_feature_wishes": int}
        }
    """
    db = get_db()
    now = datetime.now(timezone.utc)
    cutoff_recent = (now - timedelta(days=window_days)).isoformat(timespec="seconds")
    cutoff_prior = (now - timedelta(days=window_days * 4)).isoformat(timespec="seconds")

    rows = list(db.query(
        "SELECT id, kind, label, ts, metadata_json "
        "FROM graph_nodes "
        "WHERE topic = :topic "
        "AND kind IN ('painpoint','product','workaround','feature_wish')",
        {"topic": topic},
    ))

    recent: list[dict] = []
    prior: list[dict] = []
    stable: list[dict] = []
    for r in rows:
        rec = _row_to_dict(r)
        ts = rec["ts"]
        if ts and ts >= cutoff_recent:
            recent.append(rec)
        elif ts and ts >= cutoff_prior:
            prior.append(rec)
        else:
            stable.append(rec)

    # Friendly keys for the UI — "new_painpoints", etc.
    # feature_wish is one kind but we pluralize for readability.
    plural = {"painpoint": "painpoints", "product": "products",
              "workaround": "workarounds", "feature_wish": "feature_wishes"}
    summary = {
        f"new_{plural[k]}": sum(1 for x in recent if x["kind"] == k)
        for k in _FINDING_KINDS
    }
    return {
        "topic": topic,
        "window_days": window_days,
        "recent": recent,
        "prior": prior,
        "stable": stable,
        "summary": summary,
    }
