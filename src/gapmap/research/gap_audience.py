"""Gap audience — the real people you can reach for each gap.

WorthBuild's edge is turning an insight into outreach: for every gap it lists
the actual humans currently voicing the pain, with a permalink you can open and
reply to. We do the same from the evidence posts already linked to each scored
gap (``gap_scores.sample_post_ids``), enriched with each author's engagement and
their audience-persona cluster.

Build requires pain scores first (``pain_scoring.score_gaps``) — that's where
the gap→evidence-post links come from. Results are cached per (gap_id, author)
in ``gap_evidence_users`` so the read path is query-only.
"""
from __future__ import annotations

import json as _json
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db


def _ensure_table() -> None:
    db = get_db()
    db.execute(
        "CREATE TABLE IF NOT EXISTS gap_evidence_users ("
        " topic TEXT NOT NULL,"
        " gap_id TEXT NOT NULL,"
        " author TEXT NOT NULL,"
        " permalink TEXT,"
        " post_id TEXT,"
        " post_title TEXT,"
        " post_score INTEGER,"
        " num_comments INTEGER,"
        " engagement INTEGER,"
        " persona_cluster_id INTEGER,"
        " persona_label TEXT,"
        " updated_at TEXT,"
        " PRIMARY KEY (topic, gap_id, author))"
    )
    db.conn.commit()


def _author_persona_map(topic: str) -> dict[str, dict[str, Any]]:
    """author → {cluster_id, label} from cached audience personas (best-effort)."""
    try:
        from .audience import get_audience_personas
        res = get_audience_personas(topic)
    except Exception:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for p in (res.get("personas") or []):
        cid = p.get("cluster_id")
        label = p.get("label") or ""
        for a in (p.get("members") or []):
            if a and a not in out:
                out[a] = {"cluster_id": cid, "label": label}
    return out


def build(topic: str) -> dict[str, Any]:
    """Roll up the people behind every scored gap for a topic. Returns
    {ok, gaps, people, rows_written}. Requires pain scores to exist first."""
    _ensure_table()
    db = get_db()
    gaps = list(db.query(
        "SELECT gap_id, title, sample_post_ids FROM gap_scores WHERE topic = ?",
        [topic],
    ))
    if not gaps:
        return {"ok": False, "topic": topic,
                "error": "no scored gaps — run gap-pain-scores --build first"}

    persona_map = _author_persona_map(topic)
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows_written = 0
    seen_people: set[str] = set()

    for g in gaps:
        try:
            post_ids = _json.loads(g.get("sample_post_ids") or "[]")
        except Exception:
            post_ids = []
        if not post_ids:
            continue
        placeholders = ",".join("?" for _ in post_ids)
        posts = list(db.query(
            f"SELECT id, coalesce(author,'') AS author, coalesce(permalink,'') AS permalink,"
            f" coalesce(title,'') AS title, coalesce(score,0) AS score,"
            f" coalesce(num_comments,0) AS num_comments"
            f" FROM posts WHERE id IN ({placeholders})",
            [str(x) for x in post_ids],
        ))
        # Dedupe by author within the gap, keep their highest-engagement post.
        best: dict[str, dict] = {}
        for p in posts:
            author = (p.get("author") or "").strip()
            if not author or author.lower() in ("[deleted]", "deleted", "automoderator"):
                continue
            eng = int(p.get("score") or 0) + int(p.get("num_comments") or 0)
            if author not in best or eng > best[author]["engagement"]:
                best[author] = {**p, "engagement": eng}
        for author, p in best.items():
            persona = persona_map.get(author, {})
            db.execute(
                "INSERT INTO gap_evidence_users(topic,gap_id,author,permalink,post_id,"
                "post_title,post_score,num_comments,engagement,persona_cluster_id,"
                "persona_label,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
                " ON CONFLICT(topic,gap_id,author) DO UPDATE SET permalink=excluded.permalink,"
                " post_id=excluded.post_id, post_title=excluded.post_title,"
                " post_score=excluded.post_score, num_comments=excluded.num_comments,"
                " engagement=excluded.engagement, persona_cluster_id=excluded.persona_cluster_id,"
                " persona_label=excluded.persona_label, updated_at=excluded.updated_at",
                [topic, g["gap_id"], author, p.get("permalink") or "", p.get("id") or "",
                 (p.get("title") or "")[:200], int(p.get("score") or 0),
                 int(p.get("num_comments") or 0), p["engagement"],
                 persona.get("cluster_id"), persona.get("label") or "", now_iso],
            )
            rows_written += 1
            seen_people.add(author)

    db.conn.commit()
    return {"ok": True, "topic": topic, "gaps": len(gaps),
            "people": len(seen_people), "rows_written": rows_written}


def get_gap_users(topic: str, gap_id: str, limit: int = 25) -> dict[str, Any]:
    """People who voiced one gap, highest engagement first."""
    _ensure_table()
    db = get_db()
    rows = list(db.query(
        "SELECT author, permalink, post_id, post_title, post_score, num_comments,"
        " engagement, persona_cluster_id, persona_label FROM gap_evidence_users"
        " WHERE topic = ? AND gap_id = ? ORDER BY engagement DESC LIMIT ?",
        [topic, gap_id, int(limit)],
    ))
    return {"ok": True, "topic": topic, "gap_id": gap_id, "count": len(rows), "rows": rows}


def get_topic_reachout(topic: str, limit: int = 50) -> dict[str, Any]:
    """Topic-wide outreach list — every person across all gaps, deduped by
    author (keeping their highest-engagement appearance), with the gaps they
    voiced. Highest engagement first."""
    _ensure_table()
    db = get_db()
    rows = list(db.query(
        "SELECT author, permalink, post_id, post_title, engagement,"
        " persona_label, gap_id FROM gap_evidence_users WHERE topic = ?"
        " ORDER BY engagement DESC",
        [topic],
    ))
    agg: dict[str, dict] = {}
    for r in rows:
        a = r["author"]
        if a not in agg:
            agg[a] = {**r, "gaps": [r["gap_id"]]}
        else:
            if r["gap_id"] not in agg[a]["gaps"]:
                agg[a]["gaps"].append(r["gap_id"])
    people = sorted(agg.values(), key=lambda x: x["engagement"], reverse=True)[: int(limit)]
    for p in people:
        p.pop("gap_id", None)
        p["gap_count"] = len(p["gaps"])
    return {"ok": True, "topic": topic, "count": len(people), "rows": people}


def export_csv(topic: str, limit: int = 200) -> dict[str, Any]:
    import csv
    import io
    data = get_topic_reachout(topic, limit=limit)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["author", "permalink", "engagement", "gap_count", "persona", "post_title"])
    for r in data["rows"]:
        w.writerow([r.get("author", ""), r.get("permalink", ""), r.get("engagement", ""),
                    r.get("gap_count", ""), r.get("persona_label", ""), r.get("post_title", "")])
    return {"ok": True, "topic": topic, "count": data["count"], "csv": buf.getvalue()}


__all__ = ["build", "get_gap_users", "get_topic_reachout", "export_csv"]
