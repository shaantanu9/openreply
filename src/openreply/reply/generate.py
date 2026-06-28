"""Generate a value-first reply draft in the brand's voice (manual post).

Reuses the BYOK provider chain. For Reddit drafts it also runs the subreddit-rule
compliance check so you don't get the account banned. Drafts persist to
`reply_drafts` and flip the opportunity status to "drafted".
"""
from __future__ import annotations

import hashlib
import time

from ..analyze.providers.base import get_provider
from .agent import get_agent
from .brand import get_brand
from .knowledge import build_knowledge_context
from .schema import init_reply_schema

# Per-platform hard length ceilings (chars). Others get a soft sentence hint.
_LIMITS = {"x": 280, "threads": 500, "bluesky": 300}

_SYS = (
    "You write authentic, value-first social replies that genuinely help the "
    "original poster. Never sound like an ad or a bot. No hashtags. No links "
    "unless explicitly asked. Mention the brand only if it is honestly the best "
    "answer to their problem, and disclose the affiliation naturally."
)


def _length_hint(platform: str) -> str:
    lim = _LIMITS.get(platform)
    return f"Keep it under {lim} characters." if lim else "Write 2-5 sentences."


def _rules_guidance(platform: str, sub: str) -> str:
    """Read the subreddit's rules BEFORE writing and turn them into explicit
    instructions the model must follow — so the reply is compliant *by
    construction* (and self-promotes only as much as the sub allows), not just
    checked afterwards. Reddit only; fail-soft to a conservative default."""
    if platform not in ("reddit", "reddit_free") or not sub:
        return ""
    try:
        from .rules import fetch_sub_rules
        rules = (fetch_sub_rules(sub).get("rules") or [])
    except Exception:
        rules = []
    if not rules:
        return (
            f"\nr/{sub}: live rules unavailable (connect Reddit for them). Be "
            "conservative — give genuine, specific help and do NOT self-promote "
            "or paste links.\n"
        )
    rules_txt = "\n".join(f"- {r['name']}: {r['desc']}" for r in rules if r.get("name"))
    return (
        f"\nSUBREDDIT RULES for r/{sub} — follow these exactly (a violation can get "
        f"the account banned):\n{rules_txt}\n"
        "Promotion: mention the brand/product ONLY if it is genuinely the single "
        "best answer to their problem AND these rules allow it. If the rules forbid "
        "self-promotion or links, do NOT name the product or paste a link — just "
        "give honest, specific help (that itself earns trust). When you do mention "
        "it, disclose the affiliation naturally in your own words.\n"
    )


def _platform_compliance(platform: str, text: str) -> dict:
    """Brand-safety / platform-rule check for non-Reddit platforms (Reddit uses
    the subreddit-rule check). Flags over-length, hashtags, and bare links."""
    notes: list[str] = []
    lim = _LIMITS.get(platform)
    if lim and len(text) > lim:
        notes.append(f"{len(text)} chars — over the {lim}-char {platform} limit.")
    if "#" in text:
        notes.append("contains a hashtag (reads promotional).")
    if "http://" in text or "https://" in text:
        notes.append("contains a link — many feeds suppress link replies.")
    return {"compliant": not notes, "notes": " ".join(notes)}


def _compliance(platform: str, sub: str, text: str, provider: str | None) -> dict:
    """Unified compliance: subreddit rules for Reddit, platform rules elsewhere."""
    if platform in ("reddit", "reddit_free") and sub:
        try:
            from .rules import check_compliance
            comp = check_compliance(sub, text, provider=provider)
            return {"compliant": bool(comp.get("compliant", True)),
                    "notes": comp.get("notes", "")}
        except Exception:
            return {"compliant": True, "notes": ""}
    return _platform_compliance(platform, text)


def _next_version(db, opportunity_id: str) -> int:
    try:
        rows = db.execute(
            "SELECT max(version) FROM reply_drafts WHERE opportunity_id=?",
            [opportunity_id],
        ).fetchone()
        return int((rows[0] or 0)) + 1
    except Exception:
        return 1


def _persist_draft(db, opp: dict, brand_id: str, text: str, source: str,
                   provider: str | None) -> dict:
    """Write a new draft version, run compliance, flip the opportunity to
    `drafted`. Shared by generate_reply (source='generated') and save_draft
    (source='edited')."""
    opportunity_id = opp["id"]
    platform = opp.get("platform") or ""
    now = int(time.time())
    version = _next_version(db, opportunity_id)
    did = hashlib.sha1(f"{opportunity_id}|{now}|{version}".encode()).hexdigest()[:16]
    comp = _compliance(platform, opp.get("sub") or "", text, provider)
    rec = {
        "id": did, "opportunity_id": opportunity_id, "brand_id": brand_id,
        "platform": platform, "text": text,
        "compliant": 1 if comp["compliant"] else 0,
        "compliance_notes": comp["notes"],
        "version": version, "source": source,
        "created_at": now, "updated_at": now,
    }
    db["reply_drafts"].upsert(rec, pk="id")
    try:
        db["reply_opportunities"].update(
            opportunity_id, {"status": "drafted", "updated_at": now})
    except Exception:
        pass
    return rec


def generate_reply(opportunity_id: str, provider: str | None = None, tone: str | None = None) -> dict:
    db = init_reply_schema()
    opp = dict(db["reply_opportunities"].get(opportunity_id))  # raises if missing
    brand = get_brand() or {}
    platform = opp["platform"]

    # Pull the agent's linked-persona knowledge (beliefs + memories + graph),
    # seeded by the post we're answering, plus a few topic-corpus excerpts.
    agent_id = brand.get("id") or "default"
    agent = get_agent(agent_id) or {}
    rq = f"{opp.get('title') or ''}\n{opp.get('body') or ''}".strip()
    knowledge = build_knowledge_context(agent_id, rq, corpus_topic=agent.get("topic"), corpus_limit=4)

    # Read the subreddit's rules first so the draft is written to comply with them
    # (and promotes the product only as much as the sub allows).
    rules_block = _rules_guidance(platform, opp.get("sub") or "")

    # The agent's self-evolving strategy (winning angles + avoid-list).
    from .playbook import playbook_block
    pb_block = playbook_block(agent_id)

    # The agent's purpose — its growth goal + what it offers. Replies are written
    # to advance the goal by being genuinely helpful first (never salesy).
    product = (agent.get("product") or brand.get("description") or "").strip()
    goal = (agent.get("goal") or "").strip()
    goal_block = (
        f"Your growth goal (advance it WITHOUT being salesy — earn trust first, "
        f"mention the product only when it's honestly the best answer): {goal}\n"
        if goal else ""
    )

    prompt = (
        f"You are replying as: {brand.get('name')} — "
        f"{brand.get('persona') or brand.get('description')}\n"
        f"What {brand.get('name')} offers (the product you may promote when relevant): "
        f"{product or '—'}\n"
        f"{goal_block}"
        f"{pb_block}"
        f"Tone: {tone or brand.get('tone')}\n"
        f"Platform: {platform}. {_length_hint(platform)}\n"
        f"{rules_block}\n"
        f"Your knowledge (reply from this — beliefs first, then memories, then corpus):\n"
        f"{knowledge}\n\n"
        f'The post you are replying to:\n"""{opp.get("title")}\n{opp.get("body")}"""\n\n'
        "Write ONE reply that genuinely helps. Lead with concrete value. Be specific. "
        "Follow the subreddit rules above exactly."
    )
    text = get_provider(provider).complete(prompt, system=_SYS, max_tokens=400, temperature=0.6).strip()

    # Self-critique: one pass to catch salesy / rule-breaking / bot-sounding /
    # off-strategy drafts and rewrite once. Toggle via OR_SELF_CRITIQUE=0.
    import os
    if os.getenv("OR_SELF_CRITIQUE", "1") == "1":
        try:
            crit = (
                f"{goal_block}{pb_block}{rules_block}\n"
                f'Draft reply:\n"""{text}"""\n\n'
                "If this is salesy, breaks a rule, sounds like a bot, or ignores the "
                "strategy, rewrite it ONCE to fix that while keeping it genuinely helpful. "
                "Return ONLY the final reply text (no preamble)."
            )
            revised = get_provider(provider).complete(
                crit, system=_SYS, max_tokens=400, temperature=0.4).strip()
            if revised and len(revised) > 20:
                text = revised
        except Exception:
            pass
    return _persist_draft(db, opp, brand.get("id", "default"), text, "generated", provider)


def save_draft(opportunity_id: str, text: str, provider: str | None = None) -> dict:
    """Persist a user-edited reply as a new draft version (gap #1). Re-runs
    compliance on the edited text and keeps the opportunity in `drafted`."""
    text = (text or "").strip()
    if not text:
        return {"error": "empty draft text"}
    db = init_reply_schema()
    try:
        opp = dict(db["reply_opportunities"].get(opportunity_id))
    except Exception as e:
        return {"error": f"no opportunity '{opportunity_id}': {e}"}
    brand = get_brand() or {}
    return _persist_draft(db, opp, brand.get("id", "default"), text, "edited", provider)


def list_drafts(opportunity_id: str) -> list[dict]:
    """All draft versions for an opportunity, newest first (draft history)."""
    db = init_reply_schema()
    return [dict(r) for r in db["reply_drafts"].rows_where(
        "opportunity_id = ?", [opportunity_id],
        order_by="coalesce(version, 0) desc, created_at desc")]


def current_draft(opportunity_id: str) -> dict | None:
    """The latest draft version, or None if none exists yet."""
    rows = list_drafts(opportunity_id)
    return rows[0] if rows else None
