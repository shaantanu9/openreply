"""Generate queue drafts from growth-collected posts.

Turns a fetched post (GitHub trending, HN hit, Product Hunt launch, etc.) into
one or more reviewable post/thread drafts and saves them to `content_queue`.
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from ..analyze.providers.base import get_provider
from ..core.db import save_content_draft
from ..reply.agent import get_active_agent


_PLATFORM_HINTS = {
    "x": "X/Twitter — punchy, ≤280 chars per post, no fluff, no hashtag spam.",
    "twitter": "X/Twitter — punchy, ≤280 chars per post, no fluff, no hashtag spam.",
    "linkedin": "LinkedIn — professional, short paragraphs with line breaks.",
    "reddit": "Reddit — conversational, zero marketing tone, Markdown ok.",
    "reddit_free": "Reddit — conversational, zero marketing tone, Markdown ok.",
}


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
    "article": (
        "a 600-900 word article in Markdown. Output, in order:\n"
        "# Title\n"
        "A 2-sentence intro.\n"
        "Exactly 3 sections, each `## Heading` followed by 2-3 paragraphs.\n"
        "End with a single line: **Takeaway:** …"
    ),
}


def _agent_context() -> tuple[str, str]:
    """Return (brand_block, voice_block) from the active agent, or generic."""
    a = get_active_agent()
    if not a:
        return ("", "")
    brand = a.get("brand") or a.get("niche") or ""
    product = a.get("product") or a.get("brand") or ""
    goal = (a.get("goal") or "").strip()
    brand_block = (
        f"Brand: {brand}\n"
        f"Product (promote only when genuinely relevant): {product or '—'}\n"
        f"{'Goal: ' + goal + chr(10) if goal else ''}"
    )
    voice_block = (
        f"Voice / persona: {a.get('persona', '')}\n"
        f"Tone: {a.get('tone', '')}\n"
        f"Audience: {a.get('audience', '')}\n"
    )
    return brand_block, voice_block


def _generate_one_draft(
    post: dict[str, Any],
    topic: str,
    platform: str,
    content_type: str,
    provider: str | None = None,
) -> dict[str, Any] | None:
    """Ask the LLM to write one draft inspired by *post*."""
    spec = _KIND_SPECS.get(content_type)
    if not spec:
        return None

    platform_hint = _PLATFORM_HINTS.get(platform.lower(), "")
    brand_block, voice_block = _agent_context()

    source_title = (post.get("title") or post.get("selftext", "")[:80] or "Source").strip()
    source_body = (post.get("selftext") or "").strip()[:1200]
    source_url = post.get("url") or post.get("permalink") or ""

    sys = (
        "You are a social content writer. Write authentic, specific, value-first "
        "content that a real expert would post. No clickbait, no fluff, no hashtag spam."
    )
    prompt = (
        f"{brand_block}"
        f"{voice_block}"
        f"Topic: {topic}\n"
        f"Platform: {platform}\n"
        f"{platform_hint + chr(10) if platform_hint else ''}"
        f"\nSource post that inspired this draft:\n"
        f"Title: {source_title}\n"
        f"Body: {source_body}\n"
        f"URL: {source_url}\n\n"
        f"Write {spec}\n\n"
        f"Output ONLY the content. Do not explain yourself."
    )

    try:
        text = get_provider(provider).complete(
            prompt, system=sys, max_tokens=900, temperature=0.7
        ).strip()
    except Exception:
        return None
    if not text:
        return None

    now = _utc_now()
    draft_id = uuid.uuid4().hex
    return {
        "id": draft_id,
        "topic": topic,
        "source_post_id": post.get("id", ""),
        "source_type": post.get("source_type", ""),
        "source_url": source_url,
        "platform": platform,
        "content_type": content_type,
        "title": source_title[:200],
        "body": text,
        "status": "draft",
        "scheduled_at": "",
        "created_at": now,
        "updated_at": now,
        "metadata_json": json.dumps({
            "author": post.get("author", ""),
            "score": post.get("score", 0),
            "flair": post.get("flair", ""),
            "sub": post.get("sub", ""),
        }, default=str),
    }


def generate_drafts_from_posts(
    topic: str,
    posts: list[dict[str, Any]],
    count: int = 3,
    platform: str = "x",
    content_type: str = "post",
    provider: str | None = None,
    persist: bool = True,
) -> list[dict[str, Any]]:
    """Generate up to *count* drafts from the highest-signal *posts*.

    Returns the saved draft rows. If *persist* is False, returns rows without
    writing to the DB (useful for previews).
    """
    # Sort by score descending; fall back to created_utc if no score.
    sorted_posts = sorted(
        posts,
        key=lambda p: (p.get("score") or 0, p.get("created_utc") or 0),
        reverse=True,
    )
    drafts: list[dict[str, Any]] = []
    for post in sorted_posts[:count]:
        draft = _generate_one_draft(post, topic, platform, content_type, provider=provider)
        if draft:
            if persist:
                save_content_draft(draft)
            drafts.append(draft)
    return drafts


def _utc_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
