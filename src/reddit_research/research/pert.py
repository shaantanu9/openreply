"""Three-Point PERT Estimation (US Navy, 1958; McConnell, 2006).

For every task in the WBS, capture three estimates: Optimistic (O),
Most Likely (M), Pessimistic (P). Then:

    Expected E  = (O + 4M + P) / 6
    Std Dev SD  = (P − O) / 6

Per project guidance from McConnell ("Software Estimation: Demystifying
the Black Art"): multiply raw coding effort by 1.5–2× for total project
effort (meetings, reviews, testing, deploy, bug fixes); add 15–20%
contingency for unknown unknowns. Separate "effort" (hours of work)
from "duration" (calendar days).

Tasks live in the `pert_tasks` table; we expose CRUD + a rollup that
sums Expected + propagates SD via sqrt(sum(SD^2)).
"""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any, Optional

from ..core.db import get_db, init_schema


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _new_id(product_id: str, label: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (label or "task").lower()).strip("-") or "task"
    return f"{product_id}--{base}-{int(datetime.now().timestamp() * 1000)}"


VALID_TIERS = ("mvp", "standard", "full")
VALID_ROLES = ("eng", "design", "qa", "pm")


def add_task(
    product_id: str,
    label: str,
    *,
    optimistic: float = 0,
    most_likely: float = 0,
    pessimistic: float = 0,
    role: str = "eng",
    notes: str = "",
    tier: str = "mvp",
) -> dict[str, Any]:
    db = get_db()
    init_schema(db)
    if not product_id:
        return {"ok": False, "error": "product_id required"}
    if not (label or "").strip():
        return {"ok": False, "error": "label required"}
    role_n = role if role in VALID_ROLES else "eng"
    tier_n = tier if tier in VALID_TIERS else "mvp"
    tid = _new_id(product_id, label)
    now = _utc_now()

    def _f(x):
        try:
            return max(0.0, float(x or 0))
        except (TypeError, ValueError):
            return 0.0

    row = {
        "id": tid,
        "product_id": product_id,
        "label": label[:200],
        "role": role_n,
        "optimistic": _f(optimistic),
        "most_likely": _f(most_likely),
        "pessimistic": _f(pessimistic),
        "notes": (notes or "")[:500],
        "tier": tier_n,
        "created_at": now,
        "updated_at": now,
    }
    db["pert_tasks"].upsert(row, pk="id")
    return {"ok": True, "task": _decorate(row)}


def update_task(task_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    if "pert_tasks" not in db.table_names():
        return {"ok": False, "error": "pert_tasks missing"}
    rows = list(db.query("SELECT * FROM pert_tasks WHERE id = ?", [task_id]))
    if not rows:
        return {"ok": False, "error": f"task '{task_id}' not found"}
    allow = {"label", "optimistic", "most_likely", "pessimistic", "role", "notes", "tier"}
    patch = {"id": task_id, "updated_at": _utc_now()}
    for k, v in (fields or {}).items():
        if k not in allow:
            continue
        if k in ("optimistic", "most_likely", "pessimistic"):
            try:
                v = max(0.0, float(v or 0))
            except (TypeError, ValueError):
                v = 0.0
        if k == "tier" and v not in VALID_TIERS:
            v = "mvp"
        if k == "role" and v not in VALID_ROLES:
            v = "eng"
        patch[k] = v
    db["pert_tasks"].upsert(patch, pk="id")
    fresh = list(db.query("SELECT * FROM pert_tasks WHERE id = ?", [task_id]))
    return {"ok": True, "task": _decorate(fresh[0]) if fresh else rows[0]}


def delete_task(task_id: str) -> dict[str, Any]:
    db = get_db()
    if "pert_tasks" not in db.table_names():
        return {"ok": False, "error": "pert_tasks missing"}
    db["pert_tasks"].delete_where("id = ?", [task_id])
    return {"ok": True, "deleted": task_id}


def list_tasks(product_id: str, tier: str = "") -> list[dict[str, Any]]:
    db = get_db()
    if "pert_tasks" not in db.table_names():
        return []
    if tier:
        rows = list(db.query(
            "SELECT * FROM pert_tasks WHERE product_id = ? AND tier = ? ORDER BY created_at",
            [product_id, tier],
        ))
    else:
        rows = list(db.query(
            "SELECT * FROM pert_tasks WHERE product_id = ? ORDER BY created_at",
            [product_id],
        ))
    return [_decorate(r) for r in rows]


def rollup(
    product_id: str,
    *,
    multiplier: float = 1.75,
    contingency_pct: float = 17.5,
    tier: str = "",
) -> dict[str, Any]:
    """Sum expected + propagate SD across all tasks for a product (or
    one tier). Apply McConnell's 1.5–2× multiplier and 15–20% contingency.
    """
    tasks = list_tasks(product_id, tier=tier)
    if not tasks:
        return {
            "ok": True, "product_id": product_id, "tier": tier or "all",
            "n": 0, "tasks": [],
            "expected_days_raw": 0, "expected_days_with_overhead": 0,
            "expected_days_with_contingency": 0,
            "stddev_days": 0,
            "by_role": {}, "by_tier": {},
        }
    raw = sum(t.get("expected") or 0 for t in tasks)
    sd2 = sum((t.get("stddev") or 0) ** 2 for t in tasks)
    by_role: dict[str, float] = {}
    by_tier: dict[str, float] = {}
    for t in tasks:
        by_role[t.get("role", "eng")] = by_role.get(t.get("role", "eng"), 0) + (t.get("expected") or 0)
        by_tier[t.get("tier", "mvp")] = by_tier.get(t.get("tier", "mvp"), 0) + (t.get("expected") or 0)
    overhead = raw * max(1.0, float(multiplier or 1))
    with_cont = overhead * (1 + max(0.0, float(contingency_pct or 0)) / 100.0)
    return {
        "ok": True,
        "product_id": product_id,
        "tier": tier or "all",
        "n": len(tasks),
        "tasks": tasks,
        "expected_days_raw": round(raw, 2),
        "expected_days_with_overhead": round(overhead, 2),
        "expected_days_with_contingency": round(with_cont, 2),
        "stddev_days": round(math.sqrt(sd2), 2),
        "multiplier": multiplier,
        "contingency_pct": contingency_pct,
        "by_role": {k: round(v, 2) for k, v in by_role.items()},
        "by_tier": {k: round(v, 2) for k, v in by_tier.items()},
    }


def _decorate(row: dict[str, Any]) -> dict[str, Any]:
    """Add expected + stddev to the task row."""
    r = dict(row or {})
    o = float(r.get("optimistic") or 0)
    m = float(r.get("most_likely") or 0)
    p = float(r.get("pessimistic") or 0)
    r["expected"] = round((o + 4 * m + p) / 6, 2)
    r["stddev"] = round(max(0.0, (p - o) / 6), 2)
    return r


__all__ = [
    "add_task", "update_task", "delete_task", "list_tasks", "rollup",
    "VALID_TIERS", "VALID_ROLES",
]
