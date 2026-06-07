"""Cross-project paper library — named collections + a unified paper view.

Phase 4 of Research Mode. Two additive tables let a paper live in any number of
named collections, independent of which topic/project gathered it:

  * ``paper_collections``       — id, name, created_at
  * ``paper_collection_items``  — (collection_id, post_id) membership

The library view lists every academic paper in the corpus (across all topics)
joined with its reading status and collection membership, so a researcher can
browse/filter their whole reading universe in one place — not one topic at a time.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db

_ACADEMIC = ("arxiv", "openalex", "pubmed", "scholar",
             "semantic_scholar", "crossref", "europepmc", "dblp")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ensure_tables() -> None:
    db = get_db()
    db.execute(
        "CREATE TABLE IF NOT EXISTS paper_collections ("
        " id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)"
    )
    db.execute(
        "CREATE TABLE IF NOT EXISTS paper_collection_items ("
        " collection_id TEXT NOT NULL, post_id TEXT NOT NULL, added_at TEXT NOT NULL,"
        " PRIMARY KEY (collection_id, post_id))"
    )
    db.conn.commit()


# ─── Collections ────────────────────────────────────────────────────────────
def create_collection(name: str) -> dict[str, Any]:
    name = (name or "").strip()
    if not name:
        return {"ok": False, "error": "name required"}
    _ensure_tables()
    db = get_db()
    cid = "col_" + hashlib.sha1(f"{name}|{_now()}".encode()).hexdigest()[:12]
    db.execute("INSERT INTO paper_collections(id, name, created_at) VALUES(?,?,?)",
               [cid, name, _now()])
    db.conn.commit()
    return {"ok": True, "id": cid, "name": name}


def list_collections() -> dict[str, Any]:
    _ensure_tables()
    db = get_db()
    rows = list(db.query(
        "SELECT c.id, c.name, c.created_at, COUNT(ci.post_id) AS count"
        " FROM paper_collections c"
        " LEFT JOIN paper_collection_items ci ON ci.collection_id = c.id"
        " GROUP BY c.id ORDER BY c.created_at DESC"
    ))
    return {"ok": True, "count": len(rows), "collections": rows}


def rename_collection(collection_id: str, name: str) -> dict[str, Any]:
    name = (name or "").strip()
    if not name:
        return {"ok": False, "error": "name required"}
    _ensure_tables()
    db = get_db()
    db.execute("UPDATE paper_collections SET name = ? WHERE id = ?", [name, collection_id])
    db.conn.commit()
    return {"ok": True, "id": collection_id, "name": name}


def delete_collection(collection_id: str) -> dict[str, Any]:
    _ensure_tables()
    db = get_db()
    db.execute("DELETE FROM paper_collection_items WHERE collection_id = ?", [collection_id])
    db.execute("DELETE FROM paper_collections WHERE id = ?", [collection_id])
    db.conn.commit()
    return {"ok": True, "id": collection_id}


def add_to_collection(collection_id: str, post_id: str) -> dict[str, Any]:
    if not collection_id or not post_id:
        return {"ok": False, "error": "collection_id and post_id required"}
    _ensure_tables()
    db = get_db()
    db.execute(
        "INSERT INTO paper_collection_items(collection_id, post_id, added_at) VALUES(?,?,?)"
        " ON CONFLICT(collection_id, post_id) DO NOTHING",
        [collection_id, post_id, _now()],
    )
    db.conn.commit()
    return {"ok": True, "collection_id": collection_id, "post_id": post_id}


def remove_from_collection(collection_id: str, post_id: str) -> dict[str, Any]:
    _ensure_tables()
    db = get_db()
    db.execute("DELETE FROM paper_collection_items WHERE collection_id = ? AND post_id = ?",
               [collection_id, post_id])
    db.conn.commit()
    return {"ok": True, "collection_id": collection_id, "post_id": post_id}


def collections_for_post(post_id: str) -> list[str]:
    _ensure_tables()
    db = get_db()
    return [r["collection_id"] for r in db.query(
        "SELECT collection_id FROM paper_collection_items WHERE post_id = ?", [post_id])]


# ─── Unified library view ───────────────────────────────────────────────────
def library(collection_id: str | None = None, status: str | None = None,
            q: str | None = None, limit: int = 300) -> dict[str, Any]:
    """Every academic paper in the corpus (deduped across topics) with its
    reading status and collection membership. Filter by collection, reading
    status, and/or a title substring."""
    _ensure_tables()
    db = get_db()
    placeholders = ",".join("?" for _ in _ACADEMIC)
    clauses = [f"coalesce(p.source_type,'reddit') IN ({placeholders})"]
    params: list[Any] = list(_ACADEMIC)
    base = (
        "SELECT DISTINCT p.id AS post_id, p.title AS title,"
        " coalesce(p.source_type,'') AS source_type, p.url AS url,"
        " coalesce(rs.status,'to_read') AS status,"
        " coalesce(p.score,0) AS cites"
        " FROM posts p"
        " LEFT JOIN paper_reading_status rs ON rs.post_id = p.id"
    )
    if collection_id:
        base += " JOIN paper_collection_items ci ON ci.post_id = p.id"
        clauses.append("ci.collection_id = ?")
        params.append(collection_id)
    else:
        # restrict to papers that are tagged under at least one topic
        base += " JOIN topic_posts tp ON tp.post_id = p.id"
    if status:
        clauses.append("coalesce(rs.status,'to_read') = ?")
        params.append(status)
    if q:
        clauses.append("lower(p.title) LIKE ?")
        params.append(f"%{q.lower()}%")
    base += " WHERE " + " AND ".join(clauses)
    base += " ORDER BY cites DESC LIMIT ?"
    params.append(int(limit))
    rows = list(db.query(base, params))
    return {"ok": True, "count": len(rows), "papers": rows}


__all__ = [
    "create_collection", "list_collections", "rename_collection", "delete_collection",
    "add_to_collection", "remove_from_collection", "collections_for_post", "library",
]
