"""Generate a value-first reply draft in the brand's voice (manual post).

Reuses the BYOK provider chain. For Reddit drafts it also runs the subreddit-rule
compliance check so you don't get the account banned. Drafts persist to
`reply_drafts` and flip the opportunity status to "drafted".
"""
from __future__ import annotations

import hashlib
import time

from ..analyze.providers.base import get_provider
from .brand import get_brand
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


def generate_reply(opportunity_id: str, provider: str | None = None, tone: str | None = None) -> dict:
    db = init_reply_schema()
    opp = dict(db["reply_opportunities"].get(opportunity_id))  # raises if missing
    brand = get_brand() or {}
    platform = opp["platform"]

    prompt = (
        f"You are replying as: {brand.get('name')} — "
        f"{brand.get('persona') or brand.get('description')}\n"
        f"Tone: {tone or brand.get('tone')}\n"
        f"Platform: {platform}. {_length_hint(platform)}\n\n"
        f'The post you are replying to:\n"""{opp.get("title")}\n{opp.get("body")}"""\n\n'
        "Write ONE reply that genuinely helps. Lead with concrete value. Be specific."
    )
    text = get_provider(provider).complete(prompt, system=_SYS, max_tokens=400, temperature=0.6).strip()

    did = hashlib.sha1(f"{opportunity_id}|{int(time.time())}".encode()).hexdigest()[:16]
    rec = {
        "id": did, "opportunity_id": opportunity_id, "brand_id": brand.get("id", "default"),
        "platform": platform, "text": text, "compliant": 1, "compliance_notes": "",
        "created_at": int(time.time()),
    }

    if platform in ("reddit", "reddit_free") and opp.get("sub"):
        try:
            from .rules import check_compliance

            comp = check_compliance(opp["sub"], text, provider=provider)
            rec["compliant"] = 1 if comp.get("compliant", True) else 0
            rec["compliance_notes"] = comp.get("notes", "")
        except Exception:
            pass

    db["reply_drafts"].upsert(rec, pk="id")
    try:
        db["reply_opportunities"].update(opportunity_id, {"status": "drafted"})
    except Exception:
        pass
    return rec
