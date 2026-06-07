"""Trend velocity — how fast a gap (or the whole topic) is growing.

Exploding Topics' value is direction, not just presence: a gap mentioned 5×
last week and 1× the week before is *accelerating* and worth more than a flat
gap mentioned 20× forever. We compute that from the ``created_utc`` of the
topic's posts — no LLM, no new table, computed on read.

For each subject we compare a recent window [now-W, now] against the prior
window [now-2W, now-W] and report posts/day in each plus a velocity %:

    velocity_pct = (recent_per_day - prior_per_day) / prior_per_day * 100

Per-gap velocity matches the topic's posts against the gap title's keywords
(LIKE over title+selftext) — best-effort, since gaps are LLM-named.
"""
from __future__ import annotations

import re as _re
import time
from typing import Any

from ..core.db import get_db

_STOP = {
    "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with", "app",
    "apps", "issue", "issues", "problem", "problems", "feature", "features",
    "user", "users", "is", "are", "be", "this", "that", "it", "no", "not",
}


def _keywords(title: str, max_kw: int = 3) -> list[str]:
    toks = [t for t in _re.split(r"[^a-zA-Z0-9]+", (title or "").lower()) if t]
    kw = [t for t in toks if len(t) >= 4 and t not in _STOP]
    # Preserve order, dedupe.
    seen: set[str] = set()
    out: list[str] = []
    for t in kw:
        if t not in seen:
            seen.add(t)
            out.append(t)
        if len(out) >= max_kw:
            break
    return out


def _window_velocity(created: list[float], window_days: int) -> dict[str, Any]:
    """Given a list of created_utc floats, compute recent vs prior counts."""
    now = time.time()
    w = window_days * 86400.0
    recent = prior = 0
    for cu in created:
        try:
            age = now - float(cu)
        except (TypeError, ValueError):
            continue
        if 0 <= age < w:
            recent += 1
        elif w <= age < 2 * w:
            prior += 1
    recent_pd = round(recent / window_days, 3)
    prior_pd = round(prior / window_days, 3)
    if prior > 0:
        velocity_pct = round((recent_pd - prior_pd) / prior_pd * 100.0, 1)
    elif recent > 0:
        velocity_pct = None  # new — no prior baseline to divide by
    else:
        velocity_pct = 0.0
    direction = (
        "new" if (prior == 0 and recent > 0)
        else "rising" if recent_pd > prior_pd
        else "falling" if recent_pd < prior_pd
        else "flat"
    )
    return {
        "recent": recent, "prior": prior,
        "recent_per_day": recent_pd, "prior_per_day": prior_pd,
        "velocity_pct": velocity_pct, "direction": direction,
        "window_days": window_days,
    }


def compute_topic_velocity(topic: str, window_days: int = 7) -> dict[str, Any]:
    """Overall posting velocity for a topic across the recent vs prior window."""
    db = get_db()
    rows = list(db.query(
        "SELECT p.created_utc AS cu FROM posts p"
        " JOIN topic_posts tp ON tp.post_id = p.id"
        " WHERE tp.topic = ? AND p.created_utc IS NOT NULL",
        [topic],
    ))
    created = [r["cu"] for r in rows if r.get("cu")]
    v = _window_velocity(created, window_days)
    return {"ok": True, "topic": topic, "total_posts": len(created), **v}


def compute_gap_velocity(
    topic: str, gap_id: str | None = None, window_days: int = 7
) -> dict[str, Any]:
    """Velocity per scored gap (or one gap). Matches the topic's posts against
    the gap title's keywords. Requires gap_scores to exist."""
    db = get_db()
    where = "WHERE topic = ?"
    params: list[Any] = [topic]
    if gap_id:
        where += " AND gap_id = ?"
        params.append(gap_id)
    gaps = list(db.query(
        f"SELECT gap_id, title FROM gap_scores {where} ORDER BY pain_score DESC",
        params,
    ))
    if not gaps:
        return {"ok": False, "topic": topic,
                "error": "no scored gaps — run gap-pain-scores --build first"}

    out_rows: list[dict[str, Any]] = []
    for g in gaps:
        kws = _keywords(g.get("title") or "")
        if not kws:
            out_rows.append({"gap_id": g["gap_id"], "title": g["title"],
                             "direction": "unknown", "velocity_pct": None,
                             "recent": 0, "prior": 0, "matched": 0})
            continue
        like_clause = " OR ".join(
            "(lower(p.title) LIKE ? OR lower(coalesce(p.selftext,'')) LIKE ?)"
            for _ in kws
        )
        like_params: list[Any] = [topic]
        for k in kws:
            like_params.extend([f"%{k}%", f"%{k}%"])
        rows = list(db.query(
            f"SELECT p.created_utc AS cu FROM posts p"
            f" JOIN topic_posts tp ON tp.post_id = p.id"
            f" WHERE tp.topic = ? AND p.created_utc IS NOT NULL AND ({like_clause})",
            like_params,
        ))
        created = [r["cu"] for r in rows if r.get("cu")]
        v = _window_velocity(created, window_days)
        out_rows.append({
            "gap_id": g["gap_id"], "title": g["title"],
            "keywords": kws, "matched": len(created), **v,
        })
    if gap_id:
        return {"ok": True, "topic": topic, **(out_rows[0] if out_rows else {})}
    return {"ok": True, "topic": topic, "count": len(out_rows), "rows": out_rows}


__all__ = ["compute_topic_velocity", "compute_gap_velocity"]
