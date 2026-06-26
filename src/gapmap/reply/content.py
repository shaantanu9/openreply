"""Content generation — posts, threads, scripts, articles from agent knowledge.

Each artifact is generated from (agent voice + a chosen angle + top corpus excerpts
for the agent's topic) via the BYOK provider chain, and saved to `content_items` as a
reviewable draft. Publishing stays manual for now (status flows draft → scheduled →
posted); outbound `publish/` adapters are a later milestone.
"""
from __future__ import annotations

import hashlib
import time

from ..analyze.providers.base import get_provider
from .agent import get_active_agent, get_agent
from .schema import init_reply_schema

_KIND_SPECS = {
    "post": "a single concise, scroll-stopping social post (no hashtags unless natural)",
    "thread": "a numbered multi-post thread of 5-8 parts, each a complete thought",
    "script": "a 30-60 second short-video script with a hook line, 3 beats, and a CTA",
    "article": "a 600-900 word article with a title, a 2-sentence intro, 3 sections, and a takeaway",
}


def _ensure(db):
    if "content_items" not in set(db.table_names()):
        db["content_items"].create(
            {
                "id": str, "agent_id": str, "kind": str, "platform": str,
                "opportunity_id": str, "title": str, "body": str,
                "compliant": int, "compliance_notes": str, "status": str,
                "scheduled_at": int, "posted_at": int, "remote_url": str,
                "angle": str, "created_at": int, "updated_at": int,
            },
            pk="id",
        )
        db["content_items"].create_index(["agent_id", "status"])
        db["content_items"].create_index(["agent_id", "kind"])
    return db


def _corpus_excerpts(topic: str, limit: int = 12) -> str:
    db = init_reply_schema()
    try:
        rows = db.execute(
            "SELECT p.title, p.selftext FROM posts p "
            "JOIN topic_posts tp ON p.id = tp.post_id "
            "WHERE tp.topic = ? ORDER BY p.score DESC LIMIT ?",
            [topic, limit],
        ).fetchall()
    except Exception:
        rows = []
    return "\n".join(f"- {t}: {(b or '')[:200]}" for t, b in rows)


def generate_content(
    kind: str,
    *,
    agent_id: str | None = None,
    platform: str | None = None,
    angle: str = "",
    provider: str | None = None,
) -> dict:
    a = get_agent(agent_id) if agent_id else get_active_agent()
    if not a:
        return {"error": "no active agent — run `gapmap agent create ...`"}
    spec = _KIND_SPECS.get(kind)
    if not spec:
        return {"error": f"unknown kind '{kind}' (post|thread|script|article)"}

    platform = platform or (a["platforms"][0] if a["platforms"] else "reddit_free")
    excerpts = _corpus_excerpts(a["topic"])
    sys = (
        "You are a social content writer for a brand. Write authentic, specific, "
        "value-first content that a real expert would post. No clickbait, no fluff, "
        "no hashtag spam. Match the brand voice exactly."
    )
    prompt = (
        f"Brand: {a['brand']} — niche: {a['niche']}\n"
        f"Voice / persona: {a['persona']}\nTone: {a['tone']}\nAudience: {a['audience']}\n"
        f"Platform: {platform}\n"
        f"Angle: {angle or 'pick the single most resonant angle from the knowledge below'}\n\n"
        f"Recent niche conversations (your live knowledge):\n"
        f"{excerpts or '(no corpus yet — run: gapmap agent refresh)'}\n\n"
        f"Write {spec}. Output ONLY the content."
    )
    try:
        text = get_provider(provider).complete(prompt, system=sys, max_tokens=900, temperature=0.7).strip()
    except Exception as e:
        return {"error": f"generation failed (LLM not configured?): {e}"}

    db = _ensure(init_reply_schema())
    now = int(time.time())
    cid = hashlib.sha1(f"{a['id']}|{kind}|{now}".encode()).hexdigest()[:16]
    rec = {
        "id": cid, "agent_id": a["id"], "kind": kind, "platform": platform,
        "opportunity_id": "", "title": (angle or kind).strip().title()[:120],
        "body": text, "compliant": 1, "compliance_notes": "", "status": "draft",
        "scheduled_at": 0, "posted_at": 0, "remote_url": "", "angle": angle,
        "created_at": now, "updated_at": now,
    }
    db["content_items"].insert(rec, pk="id")
    return rec


def list_content(
    agent_id: str | None = None, kind: str | None = None, status: str | None = None, limit: int = 50
) -> list[dict]:
    db = _ensure(init_reply_schema())
    a = get_agent(agent_id) if agent_id else get_active_agent()
    where = "agent_id = ?"
    args: list = [a["id"] if a else ""]
    if kind:
        where += " AND kind = ?"
        args.append(kind)
    if status:
        where += " AND status = ?"
        args.append(status)
    return [dict(r) for r in db["content_items"].rows_where(where, args, order_by="created_at desc", limit=limit)]
