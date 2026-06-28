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
from .knowledge import build_knowledge_context
from .schema import init_reply_schema

# Each spec is a structured instruction block (not a one-liner) so every kind
# produces properly-shaped output. New kinds: youtube (long-form), followup_reply,
# followup_post. `script` stays the short vertical (Reels/Shorts/TikTok) form.
_KIND_SPECS = {
    "post": (
        "a single concise, scroll-stopping social post. One idea, said well. "
        "No hashtags unless genuinely natural, no emoji spam."
    ),
    "thread": (
        "a numbered multi-post thread of 5-8 parts. Part 1 is a strong hook; "
        "each following part is one complete thought; the last part lands a "
        "takeaway or soft CTA. Number them 1/, 2/, …"
    ),
    "script": (
        "a 30-60 second vertical short-video script (Reels/Shorts/TikTok), ~120 "
        "spoken words. Structure, each on its own line and labelled:\n"
        "HOOK: (first line must stop the scroll)\n"
        "BEAT 1: …\nBEAT 2: …\nBEAT 3: …\nCTA: (one clear next step)"
    ),
    "youtube": (
        "a long-form YouTube video script (~5-8 minutes of spoken delivery). "
        "Use these sections in order, each header in CAPS on its own line:\n"
        "HOOK — 1-2 punchy lines that promise the payoff\n"
        "INTRO — who this is for and why keep watching\n"
        "SEGMENT 1..N — 3 to 5 titled segments; end each with a `[VISUAL: …]` cue\n"
        "CTA — subscribe + the single next action\n"
        "OUTRO — quick recap and sign-off\n"
        "Write it as spoken word, not bullet notes."
    ),
    "article": (
        "a 600-900 word article in Markdown. Output, in order:\n"
        "# Title\n"
        "A 2-sentence intro.\n"
        "Exactly 3 sections, each `## Heading` followed by 2-3 paragraphs.\n"
        "End with a single line: **Takeaway:** …"
    ),
    "followup_reply": (
        "a single follow-up reply to the latest response in the conversation "
        "context below. Acknowledge their specific point, add real value or a "
        "fresh angle, and stay human — never salesy, never templated. One reply, "
        "no preamble."
    ),
    "followup_post": (
        "a follow-up to your earlier content (the ORIGINAL below). It must stand "
        "alone yet build on it — an update, a part 2, or a lesson learned since. "
        "Same brand voice, same format family as the original."
    ),
    "repurpose": (
        "a rewrite of the SOURCE POST below in your own voice. Keep the core "
        "insight; replace the original author's framing, sentence structure, and "
        "wording entirely. Improve clarity and punch where you can. Match the "
        "natural format and length for the platform."
    ),
}

# Kinds that consume external context (a thread reply, prior draft, or source post).
_CONTEXT_KINDS = {"followup_reply", "followup_post", "repurpose"}

# Per-platform length / format hint appended to the prompt.
_PLATFORM_HINTS = {
    "x": "Platform style: X/Twitter — punchy, ≤280 chars per post, no fluff.",
    "twitter": "Platform style: X/Twitter — punchy, ≤280 chars per post, no fluff.",
    "linkedin": "Platform style: LinkedIn — professional, short paragraphs with line breaks.",
    "reddit": "Platform style: Reddit — conversational, zero marketing tone, Markdown ok.",
    "reddit_free": "Platform style: Reddit — conversational, zero marketing tone, Markdown ok.",
    "youtube": "Platform style: YouTube — spoken-word delivery with clear segment labels.",
}

# Longer kinds get a bigger token budget.
_KIND_TOKENS = {
    "post": 500, "thread": 800, "script": 600,
    "youtube": 1500, "article": 1500,
    "followup_reply": 500, "followup_post": 800, "repurpose": 700,
}


def _ensure(db):
    if "content_items" not in set(db.table_names()):
        db["content_items"].create(
            {
                "id": str, "agent_id": str, "kind": str, "platform": str,
                "opportunity_id": str, "parent_id": str, "title": str, "body": str,
                "compliant": int, "compliance_notes": str, "status": str,
                "scheduled_at": int, "posted_at": int, "remote_url": str,
                "angle": str, "created_at": int, "updated_at": int,
            },
            pk="id",
        )
        db["content_items"].create_index(["agent_id", "status"])
        db["content_items"].create_index(["agent_id", "kind"])
    elif "parent_id" not in set(db["content_items"].columns_dict):
        # Migrate older DBs: add the follow-up linkage column in place.
        db["content_items"].add_column("parent_id", str)
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


def _load_original(content_id: str) -> dict | None:
    """Fetch a prior content_items row (the 'original' a follow-up builds on)."""
    if not content_id:
        return None
    db = _ensure(init_reply_schema())
    rows = list(db["content_items"].rows_where("id = ?", [content_id], limit=1))
    return rows[0] if rows else None


def generate_content(
    kind: str,
    *,
    agent_id: str | None = None,
    platform: str | None = None,
    angle: str = "",
    context_id: str | None = None,
    context_text: str = "",
    provider: str | None = None,
) -> dict:
    a = get_agent(agent_id) if agent_id else get_active_agent()
    if not a:
        return {"error": "no active agent — run `openreply agent create ...`"}
    spec = _KIND_SPECS.get(kind)
    if not spec:
        return {"error": f"unknown kind '{kind}' ({'|'.join(_KIND_SPECS)})"}

    platform = platform or (a["platforms"][0] if a["platforms"] else "reddit_free")
    # Blend the agent's linked personas' beliefs + memories + graph neighbors
    # with the topic corpus. Seed retrieval from the angle, else the thread
    # context (for follow-ups), else the agent's tracked keywords.
    query = angle or context_text or " ".join(a.get("keywords") or [])
    knowledge = build_knowledge_context(a["id"], query, corpus_topic=a["topic"], corpus_limit=4)

    # Follow-up kinds need conversation / prior-draft context to build on.
    parent_id = ""
    context_block = ""
    if kind in _CONTEXT_KINDS:
        if kind == "followup_post":
            orig = _load_original(context_id) if context_id else None
            if orig and (orig.get("body") or "").strip():
                parent_id = orig["id"]
                context_block = f"\nORIGINAL (your earlier {orig['kind']}):\n{orig['body']}\n"
            elif context_text.strip():
                context_block = f"\nORIGINAL:\n{context_text.strip()}\n"
            else:
                return {"error": "followup_post needs --context-id (a prior draft) or --context-text"}
        elif kind == "repurpose":
            if not context_text.strip():
                return {"error": "repurpose needs --context-text (the source post to rewrite)"}
            context_block = f"\nSOURCE POST (rewrite this in your voice — keep the insight, shed the framing):\n{context_text.strip()}\n"
        else:  # followup_reply
            if not context_text.strip():
                return {"error": "followup_reply needs --context-text (the thread + the reply to answer)"}
            context_block = f"\nCONVERSATION CONTEXT (answer the latest reply):\n{context_text.strip()}\n"

    platform_hint = _PLATFORM_HINTS.get((platform or "").lower(), "")
    # Goal + self-evolving strategy so content advances the agent's objective
    # (promote the product helpfully), not just generic value.
    from .playbook import playbook_block
    pb_block = playbook_block(a["id"])
    goal = (a.get("goal") or "").strip()
    goal_block = (f"Goal (advance it without being salesy — help first): {goal}\n" if goal else "")
    product = (a.get("product") or a.get("brand") or a.get("niche") or "").strip()
    sys = (
        "You are a social content writer for a brand. Write authentic, specific, "
        "value-first content that a real expert would post. No clickbait, no fluff, "
        "no hashtag spam. Match the brand voice exactly."
    )
    prompt = (
        f"Brand: {a['brand']} — niche: {a['niche']}\n"
        f"Product (promote when genuinely relevant): {product or '—'}\n"
        f"{goal_block}"
        f"{pb_block}"
        f"Voice / persona: {a['persona']}\nTone: {a['tone']}\nAudience: {a['audience']}\n"
        f"Platform: {platform}\n"
        f"{platform_hint + chr(10) if platform_hint else ''}"
        f"Angle: {angle or 'pick the single most resonant angle from the knowledge below'}\n"
        f"{context_block}\n"
        f"Your knowledge (write from this — beliefs first, then memories, then corpus):\n"
        f"{knowledge}\n\n"
        f"Write {spec}\n\nOutput ONLY the content."
    )
    try:
        max_tokens = _KIND_TOKENS.get(kind, 900)
        text = get_provider(provider).complete(
            prompt, system=sys, max_tokens=max_tokens, temperature=0.7
        ).strip()
    except Exception as e:
        return {"error": f"generation failed (LLM not configured?): {e}"}

    db = _ensure(init_reply_schema())
    now = int(time.time())
    cid = hashlib.sha1(f"{a['id']}|{kind}|{now}".encode()).hexdigest()[:16]
    rec = {
        "id": cid, "agent_id": a["id"], "kind": kind, "platform": platform,
        "opportunity_id": "", "parent_id": parent_id,
        "title": (angle or kind.replace("_", " ")).strip().title()[:120],
        "body": text, "compliant": 1, "compliance_notes": "", "status": "draft",
        "scheduled_at": 0, "posted_at": 0, "remote_url": "", "angle": angle,
        "created_at": now, "updated_at": now,
    }
    db["content_items"].insert(rec, pk="id")
    return rec


def update_content(
    content_id: str,
    *,
    body: str | None = None,
    status: str | None = None,
    scheduled_at: int | None = None,
) -> dict:
    """Edit / save / schedule an existing draft. Returns the updated row."""
    db = _ensure(init_reply_schema())
    rows = list(db["content_items"].rows_where("id = ?", [content_id], limit=1))
    if not rows:
        return {"error": f"no content item '{content_id}'"}
    patch: dict = {"updated_at": int(time.time())}
    if body is not None:
        patch["body"] = body
    if status is not None:
        if status not in ("draft", "scheduled", "posted"):
            return {"error": "status must be draft|scheduled|posted"}
        patch["status"] = status
        if status == "posted":
            patch["posted_at"] = int(time.time())
    if scheduled_at is not None:
        patch["scheduled_at"] = int(scheduled_at)
    db["content_items"].update(content_id, patch)
    return dict(db["content_items"].get(content_id))


def delete_content(content_id: str) -> dict:
    """Delete a content draft. Returns {ok, id}; never raises."""
    db = _ensure(init_reply_schema())
    try:
        if not list(db["content_items"].rows_where("id = ?", [content_id], limit=1)):
            return {"ok": False, "error": f"no content item '{content_id}'"}
        db["content_items"].delete(content_id)
        return {"ok": True, "id": content_id}
    except Exception as e:
        return {"ok": False, "error": str(e)}


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
