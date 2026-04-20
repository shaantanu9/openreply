"""Phase-10 — Research ↔ finding linking via the semantic palace.

Matches each painpoint/feature-wish/workaround to the top-3 most
semantically similar academic papers in the corpus. Surfaces as
"📄 3 papers address this" clickable chips on finding cards.

Architecture:
  1. For each finding, take `title + narrative + best_quote` as the
     query text
  2. Query the ChromaDB palace (already shipped) for the top-K most
     similar posts where source_type in (arxiv, openalex, pubmed,
     scholar, ingest)
  3. Persist links to `finding_research_links` table — cheap idempotent
     refresh on every synthesize run
  4. Insights UI reads the links when rendering the academic_backing chip

Degrades gracefully: if palace not available (chromadb not installed
or model not warmed), returns without linking. Findings still render;
they just don't have paper citations attached.

See docs/ROADMAP.md §10.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ensure_table() -> None:
    """Lazy-create the links table. Called from link_all_findings so a
    user who never runs palace linking doesn't carry an unused table."""
    db = get_db()
    if "finding_research_links" in db.table_names():
        return
    db["finding_research_links"].create(
        {
            "finding_id": str,      # composite: topic::title
            "topic": str,
            "finding_title": str,
            "paper_post_id": str,   # posts.id
            "similarity": float,    # 0-1
            "linked_at": str,
        },
        pk=("finding_id", "paper_post_id"),
    )
    db["finding_research_links"].create_index(["topic"])
    db["finding_research_links"].create_index(["finding_title"])


def _finding_query_text(finding: dict) -> str:
    parts = [
        finding.get("title", ""),
        finding.get("narrative", ""),
        finding.get("best_quote", ""),
    ]
    return " ".join(p for p in parts if p).strip()


def link_findings_for_topic(topic: str, k: int = 3) -> dict[str, Any]:
    """Match each finding in `topic_insights.report_json` to top-K
    academic papers in the corpus. Upserts into finding_research_links.

    Returns:
        {
          "ok": True, "topic": topic, "linked": N,
          "findings_processed": M, "papers_per_finding": k,
          "skipped": False  (or True with reason if palace unavailable)
        }
    """
    db = get_db()

    # 1. Load findings from topic_insights
    if "topic_insights" not in db.table_names():
        return {"ok": False, "topic": topic,
                "error": "topic_insights table missing — run synthesize first"}
    rows = list(db.query(
        "SELECT report_json FROM topic_insights WHERE topic = ?",
        [topic],
    ))
    if not rows:
        return {"ok": False, "topic": topic, "error": "no synthesis yet for this topic"}
    try:
        report = json.loads(rows[0]["report_json"] or "{}")
    except Exception:
        return {"ok": False, "topic": topic, "error": "malformed topic_insights row"}
    findings = report.get("findings") or []
    if not findings:
        return {"ok": True, "topic": topic, "linked": 0, "findings_processed": 0,
                "papers_per_finding": k, "note": "no findings to link"}

    # 2. Check palace availability. Degrade gracefully.
    try:
        from ..retrieval.palace import is_available, is_model_ready, search_posts
    except ImportError:
        return {"ok": True, "topic": topic, "skipped": True,
                "reason": "retrieval extras not installed (pip install reddit-myind[retrieval])"}
    if not is_available():
        return {"ok": True, "topic": topic, "skipped": True,
                "reason": "palace not available"}
    if not is_model_ready():
        return {"ok": True, "topic": topic, "skipped": True,
                "reason": "ONNX model not cached — warm via Settings first"}

    _ensure_table()

    # 3. Enumerate academic source types in this corpus
    ACADEMIC = ("arxiv", "openalex", "pubmed", "scholar", "ingest")

    # 4. Query palace per finding; filter results to academic source types
    linked_count = 0
    for f in findings:
        title = (f.get("title") or "").strip()
        if not title:
            continue
        query = _finding_query_text(f)
        if not query:
            continue
        finding_id = f"{topic}::{title.lower()}"
        # Over-fetch then post-filter — palace doesn't support source_type filter
        # as first-class, so pull 15 and keep top-K academic
        try:
            hits = search_posts(query=query, topic=topic, k=15) or []
        except Exception:
            continue
        academic_hits = []
        for h in hits:
            meta = h.get("metadata") or {}
            src = (meta.get("source_type") or "").lower()
            if src in ACADEMIC:
                academic_hits.append(h)
            if len(academic_hits) >= k:
                break
        now = _utc_now()
        for h in academic_hits:
            pid = h.get("id") or h.get("post_id")
            if not pid:
                continue
            sim = float(h.get("score") or 0)
            db["finding_research_links"].upsert(
                {
                    "finding_id": finding_id,
                    "topic": topic,
                    "finding_title": title,
                    "paper_post_id": pid,
                    "similarity": sim,
                    "linked_at": now,
                },
                pk=("finding_id", "paper_post_id"),
            )
            linked_count += 1

    return {
        "ok": True, "topic": topic, "linked": linked_count,
        "findings_processed": len(findings), "papers_per_finding": k,
    }


def get_links_for_finding(topic: str, finding_title: str) -> list[dict]:
    """Return linked papers for a specific finding, joined with the
    posts table so UI gets title + url + author + abstract excerpt in
    one query."""
    db = get_db()
    if "finding_research_links" not in db.table_names():
        return []
    sql = """
      SELECT l.paper_post_id AS id, l.similarity,
             p.title, p.url, p.permalink, p.author,
             coalesce(p.source_type,'reddit') AS source_type,
             substr(p.selftext, 1, 300) AS excerpt
      FROM finding_research_links l
      LEFT JOIN posts p ON p.id = l.paper_post_id
      WHERE l.topic = ? AND lower(l.finding_title) = lower(?)
      ORDER BY l.similarity DESC
    """
    return list(db.query(sql, [topic, finding_title]))


def get_links_summary(topic: str) -> dict[str, int]:
    """Count of linked papers per finding title — for chip rendering
    on Insights without the full join."""
    db = get_db()
    if "finding_research_links" not in db.table_names():
        return {}
    rows = db.query(
        "SELECT finding_title, count(*) AS n FROM finding_research_links "
        "WHERE topic = ? GROUP BY finding_title",
        [topic],
    )
    return {r["finding_title"]: r["n"] for r in rows}


__all__ = ["link_findings_for_topic", "get_links_for_finding", "get_links_summary"]
