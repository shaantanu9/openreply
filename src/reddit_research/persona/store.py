"""Persona CRUD + memory listing. Pure SQLite, no LLM calls here."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row_to_dict(cur, row) -> dict:
    return dict(zip([c[0] for c in cur.description], row))


# ── CRUD ────────────────────────────────────────────────────────────────────

def create_persona(
    name: str,
    goal: str,
    lens: str,
    system_prompt: str | None = None,
    color: str | None = None,
    icon: str | None = None,
    active: bool = True,
) -> dict:
    name = (name or "").strip()
    goal = (goal or "").strip()
    lens = (lens or "").strip().lower()
    if not (name and goal and lens):
        return {"ok": False, "error": "name, goal, lens all required"}

    db = get_db()
    if db.execute("SELECT 1 FROM personas WHERE name = ?", [name]).fetchone():
        return {"ok": False, "error": f"persona '{name}' already exists"}

    now = _now()
    sp = (system_prompt or "").strip() or (
        f"You are {name}, a learning agent whose sole goal is: {goal}. "
        f"Your lens is '{lens}'. Extract only insights that fit this lens."
    )
    db["personas"].insert({
        "name": name,
        "goal": goal,
        "lens": lens,
        "system_prompt": sp,
        "color": color or "#7c3aed",
        "icon": icon or "sparkles",
        "active": 1 if active else 0,
        "created_at": now,
        "updated_at": now,
    })
    pid = db.execute("SELECT id FROM personas WHERE name = ?", [name]).fetchone()[0]
    return {"ok": True, "id": pid, "name": name}


def list_personas(active_only: bool = False) -> list[dict]:
    db = get_db()
    sql = (
        "SELECT id, name, goal, lens, system_prompt, color, icon, active, "
        "created_at, updated_at FROM personas"
    )
    if active_only:
        sql += " WHERE active = 1"
    sql += " ORDER BY id ASC"
    cur = db.execute(sql)
    cols = [c[0] for c in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    for r in rows:
        r["stats"] = persona_stats(r["id"])
    return rows


def get_persona(persona_id: int) -> dict | None:
    db = get_db()
    cur = db.execute(
        "SELECT id, name, goal, lens, system_prompt, color, icon, active, "
        "created_at, updated_at FROM personas WHERE id = ?",
        [persona_id],
    )
    row = cur.fetchone()
    if not row:
        return None
    out = dict(zip([c[0] for c in cur.description], row))
    out["stats"] = persona_stats(persona_id)
    return out


def update_persona(persona_id: int, **fields: Any) -> dict:
    allowed = {"name", "goal", "lens", "system_prompt", "color", "icon", "active"}
    patch = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not patch:
        return {"ok": False, "error": "no allowed fields supplied"}
    patch["updated_at"] = _now()
    db = get_db()
    sets = ", ".join(f"{k} = ?" for k in patch)
    vals = list(patch.values()) + [persona_id]
    db.execute(f"UPDATE personas SET {sets} WHERE id = ?", vals)
    return {"ok": True, "id": persona_id}


def delete_persona(persona_id: int) -> dict:
    db = get_db()
    db.execute("DELETE FROM persona_memories WHERE persona_id = ?", [persona_id])
    db.execute("DELETE FROM persona_edges WHERE persona_id = ?", [persona_id])
    db.execute("DELETE FROM persona_conclusions WHERE persona_id = ?", [persona_id])
    db.execute("DELETE FROM personas WHERE id = ?", [persona_id])
    return {"ok": True, "id": persona_id}


# ── Stats + memory listing ──────────────────────────────────────────────────

def persona_stats(persona_id: int) -> dict:
    db = get_db()
    n_mem = db.execute(
        "SELECT COUNT(*) FROM persona_memories WHERE persona_id = ?", [persona_id]
    ).fetchone()[0]
    n_edge = db.execute(
        "SELECT COUNT(*) FROM persona_edges WHERE persona_id = ?", [persona_id]
    ).fetchone()[0]
    n_conc = db.execute(
        "SELECT COUNT(*) FROM persona_conclusions WHERE persona_id = ?", [persona_id]
    ).fetchone()[0]
    topics_row = db.execute(
        "SELECT COUNT(DISTINCT topic) FROM persona_memories WHERE persona_id = ?",
        [persona_id],
    ).fetchone()
    n_topics = topics_row[0] if topics_row else 0
    last_row = db.execute(
        "SELECT MAX(created_at) FROM persona_memories WHERE persona_id = ?",
        [persona_id],
    ).fetchone()
    last_at = last_row[0] if last_row else None
    return {
        "memories": int(n_mem),
        "edges": int(n_edge),
        "conclusions": int(n_conc),
        "topics_seen": int(n_topics),
        "last_memory_at": last_at,
    }


def list_memories(
    persona_id: int,
    *,
    topic: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    db = get_db()
    sql = (
        "SELECT m.id, m.persona_id, m.source_post_id, m.topic, m.lesson, "
        "m.excerpt, m.tags, m.importance, m.created_at, "
        "p.title AS post_title, p.url AS post_url, p.source_type AS post_source "
        "FROM persona_memories m LEFT JOIN posts p ON p.id = m.source_post_id "
        "WHERE m.persona_id = ?"
    )
    params: list[Any] = [persona_id]
    if topic:
        sql += " AND m.topic = ?"
        params.append(topic)
    sql += " ORDER BY m.created_at DESC LIMIT ? OFFSET ?"
    params.extend([int(limit), int(offset)])
    cur = db.execute(sql, params)
    cols = [c[0] for c in cur.description]
    out = []
    for r in cur.fetchall():
        d = dict(zip(cols, r))
        try:
            d["tags"] = json.loads(d.get("tags") or "[]")
        except (TypeError, ValueError):
            d["tags"] = []
        out.append(d)
    return out
