"""Reading workspace for papers — reading status + highlights/notes.

Phase 1 of Research Mode. Two small, additive tables back the per-paper reading
loop:

  * ``paper_reading_status`` — to_read | reading | read, per paper. Powers the
    to-read queue and "next up" surfaces.
  * ``paper_highlights`` — a highlighted span (section + char range + quoted
    text) with an optional note and colour. Surfaced in the Reader margin and
    injected into the paper's cited chat as "the reader's own marks".

Both are idempotent CREATE-IF-NOT-EXISTS (no migration to existing tables).
Everything keys on ``post_id`` (a paper's id in ``posts``), so a paper reached
from any topic shares one reading state.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db

VALID_STATUS = ("to_read", "reading", "read")
_DEFAULT_COLOR = "yellow"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ensure_tables() -> None:
    db = get_db()
    db.execute(
        "CREATE TABLE IF NOT EXISTS paper_reading_status ("
        " post_id TEXT PRIMARY KEY,"
        " status TEXT NOT NULL,"
        " updated_at TEXT NOT NULL)"
    )
    db.execute(
        "CREATE TABLE IF NOT EXISTS paper_highlights ("
        " id TEXT PRIMARY KEY,"
        " post_id TEXT NOT NULL,"
        " section TEXT,"
        " char_start INTEGER,"
        " char_end INTEGER,"
        " quote TEXT,"
        " note TEXT,"
        " color TEXT,"
        " created_at TEXT NOT NULL)"
    )
    try:
        db.execute("CREATE INDEX IF NOT EXISTS idx_highlights_post ON paper_highlights(post_id)")
    except Exception:
        pass
    db.conn.commit()


# ─── Reading status ─────────────────────────────────────────────────────────
def set_status(post_id: str, status: str) -> dict[str, Any]:
    """Set a paper's reading status. status ∈ to_read|reading|read."""
    if status not in VALID_STATUS:
        return {"ok": False, "error": f"status must be one of {VALID_STATUS}"}
    if not post_id:
        return {"ok": False, "error": "post_id required"}
    _ensure_tables()
    db = get_db()
    db.execute(
        "INSERT INTO paper_reading_status(post_id, status, updated_at) VALUES(?,?,?)"
        " ON CONFLICT(post_id) DO UPDATE SET status=excluded.status,"
        " updated_at=excluded.updated_at",
        [post_id, status, _now()],
    )
    db.conn.commit()
    return {"ok": True, "post_id": post_id, "status": status}


def get_status(post_id: str) -> dict[str, Any]:
    """Return {post_id, status, updated_at}. Unseen papers default to 'to_read'."""
    _ensure_tables()
    db = get_db()
    rows = list(db.query(
        "SELECT post_id, status, updated_at FROM paper_reading_status WHERE post_id = ?",
        [post_id],
    ))
    if not rows:
        return {"ok": True, "post_id": post_id, "status": "to_read", "updated_at": None}
    r = rows[0]
    return {"ok": True, "post_id": r["post_id"], "status": r["status"], "updated_at": r["updated_at"]}


def list_status(topic: str | None = None, status: str | None = None) -> dict[str, Any]:
    """List reading statuses, optionally scoped to a topic's papers and/or a
    single status. Joins ``posts`` for title so callers can render rows."""
    if status is not None and status not in VALID_STATUS:
        return {"ok": False, "error": f"status must be one of {VALID_STATUS}"}
    _ensure_tables()
    db = get_db()
    clauses, params = [], []
    base = (
        "SELECT rs.post_id AS post_id, rs.status AS status, rs.updated_at AS updated_at,"
        " p.title AS title, coalesce(p.source_type,'') AS source_type"
        " FROM paper_reading_status rs JOIN posts p ON p.id = rs.post_id"
    )
    if topic:
        base += " JOIN topic_posts tp ON tp.post_id = rs.post_id"
        clauses.append("tp.topic = ?")
        params.append(topic)
    if status:
        clauses.append("rs.status = ?")
        params.append(status)
    if clauses:
        base += " WHERE " + " AND ".join(clauses)
    base += " ORDER BY rs.updated_at DESC"
    rows = list(db.query(base, params))
    return {"ok": True, "count": len(rows), "items": rows}


def reading_queue(topic: str | None = None, limit: int = 50) -> dict[str, Any]:
    """The to-read queue: papers explicitly marked to_read, plus (when scoped to
    a topic) papers in that topic that have no status row yet — they're
    implicitly to-read. Most-recent first."""
    _ensure_tables()
    db = get_db()
    if topic:
        rows = list(db.query(
            "SELECT p.id AS post_id, p.title AS title,"
            " coalesce(rs.status,'to_read') AS status,"
            " coalesce(p.source_type,'') AS source_type"
            " FROM topic_posts tp JOIN posts p ON p.id = tp.post_id"
            " LEFT JOIN paper_reading_status rs ON rs.post_id = p.id"
            " WHERE tp.topic = ? AND coalesce(rs.status,'to_read') = 'to_read'"
            " ORDER BY p.score DESC LIMIT ?",
            [topic, limit],
        ))
    else:
        rows = list(db.query(
            "SELECT rs.post_id AS post_id, p.title AS title, rs.status AS status,"
            " coalesce(p.source_type,'') AS source_type"
            " FROM paper_reading_status rs JOIN posts p ON p.id = rs.post_id"
            " WHERE rs.status = 'to_read' ORDER BY rs.updated_at DESC LIMIT ?",
            [limit],
        ))
    return {"ok": True, "count": len(rows), "items": rows}


def status_counts(topic: str | None = None) -> dict[str, Any]:
    """{to_read, reading, read} counts — for progress chips on Home/Project."""
    res = list_status(topic=topic)
    counts = {s: 0 for s in VALID_STATUS}
    for it in res.get("items", []):
        counts[it["status"]] = counts.get(it["status"], 0) + 1
    return {"ok": True, "counts": counts}


# ─── Highlights + notes ─────────────────────────────────────────────────────
def _highlight_id(post_id: str, section: str, char_start: int, char_end: int) -> str:
    h = hashlib.sha1(f"{post_id}|{section}|{char_start}|{char_end}".encode()).hexdigest()[:16]
    return f"hl_{h}"


def add_highlight(
    post_id: str,
    *,
    section: str = "",
    char_start: int = 0,
    char_end: int = 0,
    quote: str = "",
    note: str = "",
    color: str = _DEFAULT_COLOR,
) -> dict[str, Any]:
    """Add (or update, on identical span) a highlight. Returns the row."""
    if not post_id:
        return {"ok": False, "error": "post_id required"}
    _ensure_tables()
    db = get_db()
    hid = _highlight_id(post_id, section, int(char_start), int(char_end))
    row = {
        "id": hid, "post_id": post_id, "section": section,
        "char_start": int(char_start), "char_end": int(char_end),
        "quote": (quote or "")[:2000], "note": note or "",
        "color": color or _DEFAULT_COLOR, "created_at": _now(),
    }
    db.execute(
        "INSERT INTO paper_highlights"
        "(id, post_id, section, char_start, char_end, quote, note, color, created_at)"
        " VALUES(?,?,?,?,?,?,?,?,?)"
        " ON CONFLICT(id) DO UPDATE SET quote=excluded.quote, note=excluded.note,"
        " color=excluded.color",
        [row["id"], row["post_id"], row["section"], row["char_start"], row["char_end"],
         row["quote"], row["note"], row["color"], row["created_at"]],
    )
    db.conn.commit()
    return {"ok": True, "highlight": row}


def list_highlights(post_id: str) -> dict[str, Any]:
    """All highlights for a paper, ordered by section then position."""
    _ensure_tables()
    db = get_db()
    rows = list(db.query(
        "SELECT id, post_id, section, char_start, char_end, quote, note, color, created_at"
        " FROM paper_highlights WHERE post_id = ? ORDER BY section, char_start",
        [post_id],
    ))
    return {"ok": True, "count": len(rows), "highlights": rows}


def update_highlight(highlight_id: str, *, note: str | None = None, color: str | None = None) -> dict[str, Any]:
    """Edit a highlight's note and/or colour."""
    _ensure_tables()
    db = get_db()
    sets, params = [], []
    if note is not None:
        sets.append("note = ?"); params.append(note)
    if color is not None:
        sets.append("color = ?"); params.append(color)
    if not sets:
        return {"ok": False, "error": "nothing to update"}
    params.append(highlight_id)
    db.execute(f"UPDATE paper_highlights SET {', '.join(sets)} WHERE id = ?", params)
    db.conn.commit()
    return {"ok": True, "id": highlight_id}


def delete_highlight(highlight_id: str) -> dict[str, Any]:
    _ensure_tables()
    db = get_db()
    db.execute("DELETE FROM paper_highlights WHERE id = ?", [highlight_id])
    db.conn.commit()
    return {"ok": True, "id": highlight_id}


def topic_notes(topic: str) -> dict[str, Any]:
    """Every highlight+note across a topic's papers — the project notebook view."""
    _ensure_tables()
    db = get_db()
    rows = list(db.query(
        "SELECT h.id, h.post_id, p.title AS title, h.section, h.quote, h.note, h.color, h.created_at"
        " FROM paper_highlights h"
        " JOIN topic_posts tp ON tp.post_id = h.post_id"
        " JOIN posts p ON p.id = h.post_id"
        " WHERE tp.topic = ? ORDER BY h.created_at DESC",
        [topic],
    ))
    return {"ok": True, "count": len(rows), "notes": rows}


# ─── Composite reader view ──────────────────────────────────────────────────
def read_view(post_id: str, *, max_section_chars: int = 20000) -> dict[str, Any]:
    """Everything the Reader UI needs for one paper, in a single call:
    title/authors/url, reading status, highlights, and the full text split into
    canonical sections. Falls back to a single 'body' section when the paper
    wasn't section-parsed, and to the abstract when no full text was cached."""
    if not post_id:
        return {"ok": False, "error": "post_id required"}
    db = get_db()
    prow = list(db.query(
        "SELECT id, title, author, url, created_utc, coalesce(source_type,'') AS source_type,"
        " coalesce(selftext,'') AS abstract FROM posts WHERE id = ?",
        [post_id],
    ))
    if not prow:
        return {"ok": False, "error": f"no paper {post_id}"}
    meta = prow[0]

    sections: list[dict] = []
    try:
        from .paper_fulltext import get_full_text
        from .paper_sections import get_sections, get_section_text
        ft = get_full_text(post_id, cache_only=True)
        if ft.get("ok") and ft.get("text"):
            secs = get_sections(post_id) or []
            if secs:
                for s in secs:
                    txt = ""
                    try:
                        txt = get_section_text(post_id, s["name"]) or ""
                    except Exception:
                        txt = ""
                    if not txt:
                        txt = (ft["text"][s.get("char_start", 0):s.get("char_end", 0)] or "")
                    sections.append({"name": s["name"], "text": txt[:max_section_chars]})
            else:
                sections.append({"name": "body", "text": ft["text"][:max_section_chars]})
    except Exception:
        sections = []

    tier = "full_text" if sections else "abstract"
    if not sections:
        sections = [{"name": "abstract", "text": meta["abstract"] or "(no full text cached — fetch it from the Papers tab)"}]

    return {
        "ok": True,
        "post_id": post_id,
        "title": meta["title"] or "Untitled",
        "author": meta["author"] or "",
        "url": meta["url"] or "",
        "source_type": meta["source_type"],
        "tier": tier,
        "status": get_status(post_id)["status"],
        "highlights": list_highlights(post_id)["highlights"],
        "sections": sections,
    }


__all__ = [
    "set_status", "get_status", "list_status", "reading_queue", "status_counts",
    "add_highlight", "list_highlights", "update_highlight", "delete_highlight",
    "topic_notes", "read_view", "VALID_STATUS",
]
