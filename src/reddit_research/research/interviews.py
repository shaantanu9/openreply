"""Customer Discovery Interviews — Mom Test (Fitzpatrick, 2013).

Manually captured 1:1 interviews with potential users. Distinct from the
social-media corpus (`posts`) — these are real conversations a PM ran
themselves with target users. Adapter for the Phase 3.1 "Customer
Discovery Interviews" requirement of the discovery framework.

Stored in the `interviews` table. Each row is one interview; the helpers
below provide CRUD plus a simple aggregation that surfaces themes
(grouping by `current_solution` + `willingness_to_pay`).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Optional

from ..core.db import get_db, init_schema


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s or "interview"


def _new_id(topic: str, name: str) -> str:
    base = f"{_slug(topic)}--{_slug(name)}"
    db = get_db()
    if "interviews" not in db.table_names():
        return base
    existing = {r["id"] for r in db.query("SELECT id FROM interviews")}
    if base not in existing:
        return base
    for i in range(2, 99):
        cand = f"{base}-{i}"
        if cand not in existing:
            return cand
    return f"{base}-{int(datetime.now().timestamp())}"


def create_interview(
    topic: str,
    interviewee_name: str,
    *,
    product_id: str = "",
    persona: str = "",
    interviewer: str = "",
    conducted_at: str = "",
    duration_min: int = 0,
    channel: str = "video",
    summary: str = "",
    full_text: str = "",
    current_solution: str = "",
    willingness_to_pay: str = "",
    jtbd_quote: str = "",
    mom_test_score: int = 0,
    follow_up: str = "pending",
    tags: Optional[list[str]] = None,
) -> dict[str, Any]:
    db = get_db()
    init_schema(db)
    iid = _new_id(topic, interviewee_name)
    now = _utc_now()
    row = {
        "id": iid,
        "topic": (topic or "").strip(),
        "product_id": (product_id or "").strip(),
        "interviewee_name": (interviewee_name or "").strip()[:120],
        "persona": (persona or "").strip()[:80],
        "interviewer": (interviewer or "").strip()[:80],
        "conducted_at": (conducted_at or now)[:25],
        "duration_min": max(0, int(duration_min or 0)),
        "channel": (channel or "video")[:20],
        "summary": (summary or "")[:2000],
        "full_text": (full_text or "")[:80000],
        "current_solution": (current_solution or "")[:300],
        "willingness_to_pay": (willingness_to_pay or "")[:120],
        "jtbd_quote": (jtbd_quote or "")[:600],
        "mom_test_score": max(0, min(int(mom_test_score or 0), 5)),
        "follow_up": (follow_up or "pending")[:20],
        "tags_json": json.dumps(list(tags or [])[:20]),
        "created_at": now,
        "updated_at": now,
    }
    db["interviews"].upsert(row, pk="id")
    return {"ok": True, "interview": _to_dict(row)}


def update_interview(interview_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    if "interviews" not in db.table_names():
        return {"ok": False, "error": "interviews table missing"}
    rows = list(db.query("SELECT * FROM interviews WHERE id = ?", [interview_id]))
    if not rows:
        return {"ok": False, "error": f"interview '{interview_id}' not found"}
    cur = rows[0]
    allow = {
        "interviewee_name", "persona", "interviewer", "conducted_at",
        "duration_min", "channel", "summary", "full_text",
        "current_solution", "willingness_to_pay", "jtbd_quote",
        "mom_test_score", "follow_up", "product_id",
    }
    patch = {"id": interview_id, "updated_at": _utc_now()}
    for k, v in (fields or {}).items():
        if k not in allow:
            continue
        if k in ("duration_min", "mom_test_score"):
            try:
                v = int(v or 0)
            except (TypeError, ValueError):
                v = 0
        patch[k] = v
    if "tags" in (fields or {}):
        patch["tags_json"] = json.dumps(list(fields.get("tags") or [])[:20])
    db["interviews"].upsert(patch, pk="id")
    fresh = list(db.query("SELECT * FROM interviews WHERE id = ?", [interview_id]))
    return {"ok": True, "interview": _to_dict(fresh[0]) if fresh else cur}


def delete_interview(interview_id: str) -> dict[str, Any]:
    db = get_db()
    if "interviews" not in db.table_names():
        return {"ok": False, "error": "interviews table missing"}
    db["interviews"].delete_where("id = ?", [interview_id])
    return {"ok": True, "deleted": interview_id}


def get_interview(interview_id: str) -> dict[str, Any]:
    db = get_db()
    if "interviews" not in db.table_names():
        return {"ok": False, "error": "interviews table missing"}
    rows = list(db.query("SELECT * FROM interviews WHERE id = ?", [interview_id]))
    if not rows:
        return {"ok": False, "error": f"interview '{interview_id}' not found"}
    return {"ok": True, "interview": _to_dict(rows[0])}


def list_interviews(topic: str, product_id: str = "") -> list[dict[str, Any]]:
    db = get_db()
    if "interviews" not in db.table_names():
        return []
    if product_id:
        rows = list(db.query(
            "SELECT * FROM interviews WHERE product_id = ? ORDER BY conducted_at DESC",
            [product_id],
        ))
    elif topic:
        rows = list(db.query(
            "SELECT * FROM interviews WHERE topic = ? ORDER BY conducted_at DESC",
            [topic],
        ))
    else:
        rows = list(db.query("SELECT * FROM interviews ORDER BY conducted_at DESC LIMIT 200"))
    return [_to_dict(r) for r in rows]


def summarize(topic: str, product_id: str = "") -> dict[str, Any]:
    rows = list_interviews(topic, product_id)
    if not rows:
        return {"ok": True, "topic": topic, "count": 0, "themes": [], "willingness_to_pay": [], "rigour_avg": 0}
    themes: dict[str, int] = {}
    wtp: dict[str, int] = {}
    rigours = []
    for r in rows:
        rigours.append(r.get("mom_test_score") or 0)
        cs = (r.get("current_solution") or "").strip().lower()[:60]
        if cs:
            themes[cs] = themes.get(cs, 0) + 1
        w = (r.get("willingness_to_pay") or "").strip()[:40]
        if w:
            wtp[w] = wtp.get(w, 0) + 1
    avg = sum(rigours) / len(rigours) if rigours else 0
    return {
        "ok": True,
        "topic": topic,
        "count": len(rows),
        "themes": sorted(
            [{"label": k, "n": v} for k, v in themes.items()],
            key=lambda x: -x["n"],
        )[:10],
        "willingness_to_pay": sorted(
            [{"label": k, "n": v} for k, v in wtp.items()],
            key=lambda x: -x["n"],
        )[:10],
        "rigour_avg": round(avg, 2),
    }


def _to_dict(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row or {})
    try:
        out["tags"] = json.loads(out.get("tags_json") or "[]")
    except Exception:
        out["tags"] = []
    out.pop("tags_json", None)
    return out


__all__ = [
    "create_interview", "update_interview", "delete_interview",
    "get_interview", "list_interviews", "summarize",
]
