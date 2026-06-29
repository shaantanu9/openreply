"""Assignable tasks — the bridge between knowledge and action.

A task captures "I should do X about this" and routes it to the right working
surface. Tasks are created three ways: from a Brain graph node ("Draft post",
"Find replies"), from a Daily Update digest item ("+ Task"), or by hand on the
Tasks board. Each task can target a section (compose/inbox/queue); opening it
seeds that surface from the task's payload.

Agent-scoped, stored in `reply_tasks` (see schema.py). status moves
todo → in_progress → done. Fail-soft: helpers never raise on bad payload JSON.
"""
from __future__ import annotations

import json
import time
import uuid

from .agent import get_agent
from .schema import init_reply_schema

VALID_STATUS = ("todo", "in_progress", "done")


def _now() -> int:
    return int(time.time())


def _agent_id(agent_id: str | None) -> str | None:
    a = get_agent(agent_id)
    return a["id"] if a else None


def _row_to_dict(r: dict) -> dict:
    payload = {}
    raw = r.get("payload_json") or ""
    if raw:
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {}
    return {
        "id": r.get("id"),
        "agent_id": r.get("agent_id"),
        "title": r.get("title") or "",
        "kind": r.get("kind") or "custom",
        "status": r.get("status") or "todo",
        "target": r.get("target") or "",
        "payload": payload,
        "source": r.get("source") or "manual",
        "source_ref": r.get("source_ref") or "",
        "note": r.get("note") or "",
        "created_at": r.get("created_at") or 0,
        "updated_at": r.get("updated_at") or 0,
        "done_at": r.get("done_at") or 0,
    }


def create_task(
    agent_id: str | None,
    title: str,
    kind: str = "custom",
    *,
    target: str = "",
    payload: dict | None = None,
    source: str = "manual",
    source_ref: str = "",
    note: str = "",
) -> dict:
    """Create a task for the agent (default: active). Returns the task dict."""
    db = init_reply_schema()
    aid = _agent_id(agent_id)
    if not aid:
        return {"ok": False, "error": "no_agent"}
    now = _now()
    row = {
        "id": uuid.uuid4().hex,
        "agent_id": aid,
        "title": (title or "Untitled task").strip(),
        "kind": kind or "custom",
        "status": "todo",
        "target": target or "",
        "payload_json": json.dumps(payload or {}),
        "source": source or "manual",
        "source_ref": source_ref or "",
        "note": note or "",
        "created_at": now,
        "updated_at": now,
        "done_at": 0,
    }
    db["reply_tasks"].insert(row)
    return {"ok": True, "task": _row_to_dict(row)}


def list_tasks(agent_id: str | None = None, status: str | None = None) -> dict:
    """All tasks for the agent, newest first within each status."""
    db = init_reply_schema()
    aid = _agent_id(agent_id)
    if not aid:
        return {"tasks": []}
    where = "agent_id = :aid"
    params = {"aid": aid}
    if status in VALID_STATUS:
        where += " and status = :st"
        params["st"] = status
    rows = list(
        db["reply_tasks"].rows_where(
            where, params, order_by="created_at desc"
        )
    )
    return {"tasks": [_row_to_dict(r) for r in rows]}


def update_task(
    task_id: str,
    *,
    status: str | None = None,
    title: str | None = None,
    note: str | None = None,
    payload: dict | None = None,
) -> dict:
    """Patch a task. Changing status to/from done maintains `done_at`."""
    db = init_reply_schema()
    try:
        r = db["reply_tasks"].get(task_id)
    except Exception:
        return {"ok": False, "error": "not_found"}
    patch: dict = {"updated_at": _now()}
    if status is not None and status in VALID_STATUS:
        patch["status"] = status
        patch["done_at"] = _now() if status == "done" else 0
    if title is not None:
        patch["title"] = title.strip() or r.get("title")
    if note is not None:
        patch["note"] = note
    if payload is not None:
        patch["payload_json"] = json.dumps(payload or {})
    db["reply_tasks"].update(task_id, patch)
    return {"ok": True, "task": _row_to_dict(db["reply_tasks"].get(task_id))}


def delete_task(task_id: str) -> dict:
    db = init_reply_schema()
    try:
        db["reply_tasks"].delete(task_id)
    except Exception:
        return {"ok": False, "error": "not_found"}
    return {"ok": True}
