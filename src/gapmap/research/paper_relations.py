"""Materialize paper->paper edges into graph_edges (academic nodes only).
Phase 1 kinds: `relates_to` (semantic neighbors) and `cites` (resolved
references). Each src capped to top-N to avoid hairballs."""
from __future__ import annotations
import json, os
from typing import Any

from ..core.db import get_db
from .sources import is_academic_source

_TOPN = int(os.getenv("PAPER_RELATES_TOPN") or 8)

def _academic_paper_ids(topic: str | None) -> list[str]:
    db = get_db()
    if topic:
        rows = db.query(
            "SELECT p.id AS id, coalesce(p.source_type,'reddit') AS s "
            "FROM topic_posts tp JOIN posts p ON p.id = tp.post_id WHERE tp.topic = ?",
            [topic])
    else:
        rows = db.query("SELECT id, coalesce(source_type,'reddit') AS s FROM posts")
    return [r["id"] for r in rows if is_academic_source(r["s"])]

def _upsert_edge(db, src: str, dst: str, kind: str, topic: str | None, weight: float, meta: dict):
    db["graph_edges"].upsert(
        {"src": src, "dst": dst, "kind": kind, "topic": topic or "",
         "weight": float(weight), "metadata_json": json.dumps(meta)},
        pk=("src", "dst", "kind"))

def build(topic: str | None = None, *, kinds: list[str] | None = None,
          force: bool = False) -> dict[str, Any]:
    kinds = kinds or ["relates_to", "cites"]
    db = get_db()
    ids = set(_academic_paper_ids(topic))
    made = {"relates_to": 0, "cites": 0}

    if "cites" in kinds:
        from .paper_references import get_references
        for pid in ids:
            for ref in get_references(pid):
                dst = ref.get("dst_post_id") or ""
                if ref.get("resolution_status") == "ok" and dst and dst in ids:
                    _upsert_edge(db, pid, dst, "cites", topic, 1.0,
                                 {"via": ref.get("extractor", "")})
                    made["cites"] += 1

    if "relates_to" in kinds:
        from ..retrieval import palace
        if palace.is_available():
            for pid in ids:
                nb = palace.paper_neighbors(pid, k=_TOPN, topic=topic)
                for r in nb.get("results", []):
                    dst = r["post_id"]
                    if dst in ids:
                        _upsert_edge(db, pid, dst, "relates_to", topic,
                                     r["score"], {"score": r["score"]})
                        made["relates_to"] += 1

    return {"ok": True, "topic": topic, "papers": len(ids), "edges": made}
