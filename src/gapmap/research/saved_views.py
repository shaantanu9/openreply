"""Saved views / smart filters (T3.1).

CRUD for the ``saved_views`` table (scope, name, filter_json, pinned),
plus a pure ``apply_filter`` helper that filters an in-memory list of
findings. UI clients typically render findings once and just hide
cards that don't match the active filter.

Filter spec (all keys optional — missing ⇒ no constraint on that axis):

    {
      "min_opportunity_score": float,
      "kinds": [str, ...],                       # finding.kind in set
      "triangulation_strength_in": [str, ...],   # finding.triangulation_strength in set
      "classification_in": [str, ...],           # finding.classification in set
    }

Scope conventions:
  - ``"global"``          — no topic/product binding
  - ``"topic:<slug>"``    — bound to a specific topic
  - ``"product:<id>"``    — bound to a specific product
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Iterable

from ..core.db import get_db


_TABLE = "saved_views"


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _to_public(row: dict[str, Any]) -> dict[str, Any]:
    """Normalise a raw DB row → API shape (parse filter_json, cast pinned)."""
    out = dict(row)
    raw = out.get("filter_json") or "{}"
    try:
        out["filter"] = json.loads(raw) if isinstance(raw, str) else (raw or {})
    except Exception:
        out["filter"] = {}
    out["pinned"] = bool(out.get("pinned"))
    return out


def create_view(
    scope: str,
    name: str,
    filter_json: dict[str, Any] | str,
    pinned: bool = False,
) -> dict[str, Any]:
    """Insert a new view and return its public shape including the new id."""
    db = get_db()
    scope = (scope or "global").strip() or "global"
    name = (name or "").strip()
    if not name:
        raise ValueError("name required")
    if isinstance(filter_json, (dict, list)):
        flt_str = json.dumps(filter_json)
    else:
        flt_str = str(filter_json or "{}")
    now = _utc_now()
    row = {
        "scope": scope,
        "name": name,
        "filter_json": flt_str,
        "pinned": 1 if pinned else 0,
        "created_at": now,
        "updated_at": now,
    }
    # Fetch the next id explicitly and pass it in. sqlite-utils' auto-id
    # behavior for int PKs is inconsistent (last_pk can be None when the
    # schema was declared with `id: int` up-front), so we own it here.
    max_row = list(db.query(f"SELECT coalesce(max(id), 0) AS m FROM {_TABLE}"))
    next_id = (max_row[0]["m"] if max_row else 0) + 1
    row["id"] = next_id
    db[_TABLE].insert(row, pk="id", alter=True)
    created = db[_TABLE].get(next_id)
    return _to_public(created)


def list_views(scope: str | None = None) -> list[dict[str, Any]]:
    """Return all views, or only those matching ``scope``. Pinned first."""
    db = get_db()
    if _TABLE not in db.table_names():
        return []
    where = "1=1"
    args: list[Any] = []
    if scope:
        where = "scope = ?"
        args = [scope]
    sql = (
        f"SELECT id, scope, name, filter_json, pinned, created_at, updated_at "
        f"FROM {_TABLE} WHERE {where} "
        f"ORDER BY pinned DESC, updated_at DESC"
    )
    try:
        rows = list(db.query(sql, args))
    except Exception:
        return []
    return [_to_public(r) for r in rows]


def get_view(view_id: int) -> dict[str, Any] | None:
    db = get_db()
    if _TABLE not in db.table_names():
        return None
    try:
        row = db[_TABLE].get(int(view_id))
    except Exception:
        return None
    if not row:
        return None
    return _to_public(row)


def update_view(view_id: int, **fields: Any) -> dict[str, Any] | None:
    """Partial update. Accepts name, scope, filter_json, pinned."""
    db = get_db()
    if _TABLE not in db.table_names():
        return None
    try:
        existing = db[_TABLE].get(int(view_id))
    except Exception:
        return None
    if not existing:
        return None
    patch: dict[str, Any] = {}
    if "name" in fields and fields["name"] is not None:
        nm = str(fields["name"]).strip()
        if nm:
            patch["name"] = nm
    if "scope" in fields and fields["scope"]:
        patch["scope"] = str(fields["scope"]).strip() or "global"
    if "filter_json" in fields and fields["filter_json"] is not None:
        v = fields["filter_json"]
        patch["filter_json"] = json.dumps(v) if isinstance(v, (dict, list)) else str(v)
    if "pinned" in fields and fields["pinned"] is not None:
        patch["pinned"] = 1 if fields["pinned"] else 0
    if not patch:
        return _to_public(existing)
    patch["updated_at"] = _utc_now()
    db[_TABLE].update(int(view_id), patch)
    updated = db[_TABLE].get(int(view_id))
    return _to_public(updated)


def delete_view(view_id: int) -> dict[str, Any]:
    db = get_db()
    if _TABLE not in db.table_names():
        return {"ok": True, "id": int(view_id), "deleted": False}
    try:
        db[_TABLE].delete(int(view_id))
        return {"ok": True, "id": int(view_id), "deleted": True}
    except Exception:
        return {"ok": True, "id": int(view_id), "deleted": False}


# ── Pure filter -----------------------------------------------------

def _as_str_set(xs: Iterable[Any] | None) -> set[str]:
    if not xs:
        return set()
    return {str(x) for x in xs if x is not None}


def apply_filter(
    findings: list[dict[str, Any]],
    filter_spec: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Filter a list of findings by the spec. Missing keys = no constraint.

    Pure function — no DB access, safe to use in tests and from the UI
    (mirrored client-side in insights.js).
    """
    if not findings:
        return []
    spec = filter_spec or {}
    min_op = spec.get("min_opportunity_score")
    try:
        min_op_f = float(min_op) if min_op is not None else None
    except (TypeError, ValueError):
        min_op_f = None
    kinds = _as_str_set(spec.get("kinds"))
    tri = _as_str_set(spec.get("triangulation_strength_in"))
    cls = _as_str_set(spec.get("classification_in"))

    out: list[dict[str, Any]] = []
    for f in findings:
        if not isinstance(f, dict):
            continue
        if min_op_f is not None:
            try:
                op = float(f.get("opportunity_score") or 0)
            except (TypeError, ValueError):
                op = 0.0
            if op < min_op_f:
                continue
        if kinds and str(f.get("kind") or "") not in kinds:
            continue
        if tri and str(f.get("triangulation_strength") or "") not in tri:
            continue
        if cls and str(f.get("classification") or "") not in cls:
            continue
        out.append(f)
    return out


__all__ = [
    "create_view",
    "list_views",
    "get_view",
    "update_view",
    "delete_view",
    "apply_filter",
]
