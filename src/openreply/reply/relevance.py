"""Corpus relevance gate — an LLM check on FETCHED content.

After a fetch the corpus can contain posts a keyword search dragged in that
aren't actually about the agent's topic. This runs each collected post through
the BYOK model: is it relevant to the agent's topic/niche? Each verdict
(relevant / off-topic + score + one-line reason) is stored in `post_relevance`
so the Library can surface on-topic items first and push off-topic ones to the
bottom with a clear tag. Never raises.
"""
from __future__ import annotations

import json
import time

from ..analyze.providers.base import get_provider
from .agent import get_agent
from .schema import init_reply_schema

_BATCH = 10


def _ensure(db):
    if "post_relevance" not in set(db.table_names()):
        db["post_relevance"].create(
            {"topic": str, "post_id": str, "relevant": int, "score": float,
             "reason": str, "checked_at": int},
            pk=("topic", "post_id"),
        )
        db["post_relevance"].create_index(["topic"])
    return db


def relevance_map(topic: str, post_ids: list[str]) -> dict:
    """{post_id: {relevant, score, reason}} for the given posts (only those checked)."""
    if not post_ids:
        return {}
    db = _ensure(init_reply_schema())
    qmarks = ",".join("?" * len(post_ids))
    out: dict = {}
    try:
        for r in db.execute(
            f"SELECT post_id, relevant, score, reason FROM post_relevance "
            f"WHERE topic = ? AND post_id IN ({qmarks})",
            [topic, *post_ids],
        ).fetchall():
            out[r[0]] = {"relevant": r[1], "score": r[2], "reason": r[3]}
    except Exception:
        pass
    return out


def _parse_array(text: str) -> list:
    t = (text or "").strip()
    if "```" in t:
        parts = t.split("```")
        t = parts[1] if len(parts) >= 2 else t
        if t.lstrip().lower().startswith("json"):
            t = t.lstrip()[4:]
    i, j = t.find("["), t.rfind("]")
    if i != -1 and j != -1 and j > i:
        t = t[i:j + 1]
    try:
        v = json.loads(t)
        return v if isinstance(v, list) else []
    except Exception:
        return []


def check_relevance(agent_id: str | None = None, *, limit: int = 60, provider: str | None = None) -> dict:
    """Classify not-yet-checked corpus posts as on-topic / off-topic. Returns counts."""
    a = get_agent(agent_id)
    if not a:
        return {"error": "no active agent"}
    topic = a.get("topic") or a.get("name")
    niche = a.get("niche") or a.get("brand") or a.get("name") or topic
    db = _ensure(init_reply_schema())

    try:
        rows = db.execute(
            "SELECT p.id, p.title, p.selftext FROM posts p "
            "JOIN topic_posts tp ON tp.post_id = p.id "
            "LEFT JOIN post_relevance pr ON pr.topic = tp.topic AND pr.post_id = p.id "
            "WHERE tp.topic = ? AND pr.post_id IS NULL "
            "ORDER BY COALESCE(p.created_utc, 0) DESC LIMIT ?",
            [topic, int(limit)],
        ).fetchall()
    except Exception as e:
        return {"error": f"corpus read failed: {e}"}
    if not rows:
        return {"checked": 0, "relevant": 0, "off_topic": 0, "message": "all caught up"}

    sys = (
        "You judge whether a fetched post is actually about a given topic/niche. "
        "Be strict: a keyword can appear without the post being on-topic. "
        "Output ONLY a JSON array, one object per post in order: "
        '[{"i": <1-based index>, "relevant": true|false, "score": 0..1, "reason": "<=8 words"}]'
    )
    now = int(time.time())
    checked = relevant = off = 0
    prov = get_provider(provider)
    for start in range(0, len(rows), _BATCH):
        batch = rows[start:start + _BATCH]
        listing = "\n".join(
            f'{k + 1}. {(t or "")[:120]} — {(b or "")[:200]}' for k, (_pid, t, b) in enumerate(batch)
        )
        prompt = (
            f"Topic: {topic}\nNiche: {niche}\n\nPosts:\n{listing}\n\n"
            "Classify each post."
        )
        try:
            raw = prov.complete(prompt, system=sys, max_tokens=700, temperature=0.0)
        except Exception:
            break  # LLM unavailable — stop; leave the rest unchecked
        verdicts = {int(v.get("i", 0)): v for v in _parse_array(raw) if isinstance(v, dict)}
        recs = []
        for k, (pid, _t, _b) in enumerate(batch):
            v = verdicts.get(k + 1, {})
            rel = 1 if v.get("relevant") else 0
            recs.append({
                "topic": topic, "post_id": pid, "relevant": rel,
                "score": float(v.get("score", 0.5) or 0.5),
                "reason": (v.get("reason") or "")[:120], "checked_at": now,
            })
            checked += 1
            relevant += rel
            off += 1 - rel
        try:
            db["post_relevance"].upsert_all(recs, pk=("topic", "post_id"))
        except Exception:
            pass
    return {"checked": checked, "relevant": relevant, "off_topic": off}
