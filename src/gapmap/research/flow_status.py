"""Per-project research-flow progress — where a topic sits in the
Gather → Read → Synthesize → Write pipeline.

Pure read over existing tables (no LLM, no writes). Powers progress chips on
Research Home + the project workspace so a researcher can see, at a glance,
how far each project has come: papers gathered, full-text fetched, chunked,
read, lit-matrix extracted, and whether a draft exists.
"""
from __future__ import annotations

from typing import Any

from ..core.db import get_db

_ACADEMIC = ("arxiv", "openalex", "pubmed", "scholar",
             "semantic_scholar", "crossref", "europepmc", "dblp")


def _count(db, sql: str, params: list) -> int:
    rows = list(db.query(sql, params))
    return int(rows[0]["c"]) if rows else 0


def _table_exists(db, name: str) -> bool:
    try:
        return name in db.table_names()
    except Exception:
        return False


def flow_status(topic: str) -> dict[str, Any]:
    """Return progress counts + a normalized stage summary for one topic.

    {ok, topic, papers, fulltext, chunked, analyzed, lit_matrix, read, reading,
     to_read, has_draft, stages:{gather,read,synthesize,write} (0..1)}.
    """
    db = get_db()
    ph = ",".join("?" for _ in _ACADEMIC)
    base_join = (
        "FROM posts p JOIN topic_posts tp ON tp.post_id = p.id"
        f" WHERE tp.topic = ? AND coalesce(p.source_type,'reddit') IN ({ph})"
    )
    args = [topic, *_ACADEMIC]
    papers = _count(db, f"SELECT COUNT(DISTINCT p.id) c {base_join}", args)

    def _scoped(extra_join: str, extra_where: str = "") -> int:
        if papers == 0:
            return 0
        return _count(
            db,
            f"SELECT COUNT(DISTINCT p.id) c FROM posts p"
            f" JOIN topic_posts tp ON tp.post_id = p.id {extra_join}"
            f" WHERE tp.topic = ? AND coalesce(p.source_type,'reddit') IN ({ph}){extra_where}",
            args,
        )

    fulltext = _scoped(
        "JOIN paper_full_texts ft ON ft.post_id = p.id", " AND ft.status = 'ok'"
    ) if _table_exists(db, "paper_full_texts") else 0
    chunked = _scoped("JOIN paper_chunks pc ON pc.post_id = p.id") if _table_exists(db, "paper_chunks") else 0
    analyzed = _scoped("JOIN paper_analyses pa ON pa.post_id = p.id") if _table_exists(db, "paper_analyses") else 0
    lit = _count(db, "SELECT COUNT(*) c FROM lit_matrix WHERE topic = ?", [topic]) if _table_exists(db, "lit_matrix") else 0

    read = reading = 0
    if _table_exists(db, "paper_reading_status"):
        read = _scoped("JOIN paper_reading_status rs ON rs.post_id = p.id", " AND rs.status = 'read'")
        reading = _scoped("JOIN paper_reading_status rs ON rs.post_id = p.id", " AND rs.status = 'reading'")
    to_read = max(0, papers - read - reading)

    has_draft = False
    if _table_exists(db, "strategy_artifacts"):
        has_draft = _count(
            db, "SELECT COUNT(*) c FROM strategy_artifacts WHERE topic = ? AND kind IN ('paper_draft','draft','paper_outline')",
            [topic],
        ) > 0

    def _frac(n: int, d: int) -> float:
        return round(n / d, 3) if d else 0.0

    stages = {
        "gather": 1.0 if papers else 0.0,
        "read": _frac(read + reading, papers),
        "synthesize": _frac(lit, papers),
        "write": 1.0 if has_draft else 0.0,
    }
    return {
        "ok": True, "topic": topic, "papers": papers, "fulltext": fulltext,
        "chunked": chunked, "analyzed": analyzed, "lit_matrix": lit,
        "read": read, "reading": reading, "to_read": to_read,
        "has_draft": has_draft, "stages": stages,
    }


__all__ = ["flow_status"]
