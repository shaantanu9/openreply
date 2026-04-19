"""Subreddit discovery — given a topic, find the most-relevant public subs.

Uses /subreddits/search.json (works in both auth and public mode).

Ranking: since `active_user_count` isn't exposed on the public endpoint,
we rank by subscribers with a relevance bonus when the topic terms appear
in the sub name or description. Also falls back to per-word searches when
the exact multi-word query returns too few results.
"""
from __future__ import annotations

import math
import re
from typing import Any

from ..core.public_client import _get


def _tokens(topic: str) -> list[str]:
    # Split to words, lower, drop stopwords that pollute search
    stop = {"the", "a", "an", "for", "of", "app", "apps", "tool", "software", "service"}
    words = re.findall(r"[a-zA-Z0-9]+", topic.lower())
    return [w for w in words if w not in stop and len(w) > 2]


def _search_raw(query: str, limit: int = 25) -> list[dict[str, Any]]:
    j = _get(
        "/subreddits/search.json",
        params={"q": query, "limit": limit, "raw_json": 1, "include_over_18": "off"},
    )
    children = j.get("data", {}).get("children", [])
    return [c["data"] for c in children if c.get("kind") == "t5"]


def _relevance_bonus(sub: dict[str, Any], tokens: list[str]) -> float:
    name = (sub.get("display_name") or "").lower()
    desc = ((sub.get("public_description") or "") + " " + (sub.get("title") or "")).lower()
    bonus = 0.0
    for t in tokens:
        if t in name:
            bonus += 1.5  # exact match in the name is strong signal
        if t in desc:
            bonus += 0.4
    return bonus


def _rank_score(sub: dict[str, Any], tokens: list[str]) -> float:
    subs = sub.get("subscribers") or 0
    if subs < 1000:  # skip tiny dead subs
        return -1
    return math.log10(max(subs, 10)) + _relevance_bonus(sub, tokens)


# ── Topic canonicalization ──────────────────────────────────────────────────
#
# Typos like "calari tracking app" silently routed to "flight tracking" subs
# before. This block adds an LLM-backed correction with a SQLite cache so the
# same typo only costs one API call per user.

_CANONICAL_PROMPT_SYSTEM = (
    "You validate whether a user's topic string represents a recognizable "
    "product category or domain. If the string contains typos, abbreviations, "
    "or ambiguity, return the most likely canonical form plus 2-3 plausible "
    "alternatives. Return JSON only — no prose."
)
_CANONICAL_PROMPT_USER = (
    "Topic: \"{topic}\"\n\n"
    "Return JSON matching: "
    "{{\"canonical\": \"<best guess>\", "
    "\"variants\": [\"<alt1>\", \"<alt2>\"], "
    "\"confidence\": \"high\" | \"low\"}}\n\n"
    "Rules:\n"
    "- If the topic looks correct and clear, return it unchanged with confidence "
    "\"high\" and 2 related variants.\n"
    "- If you're confident about a typo fix (e.g., \"calari\" is almost "
    "certainly \"calorie\"), return the fix with confidence \"high\".\n"
    "- If ambiguous (could be interpreted multiple ways), set confidence \"low\" "
    "and put multiple plausible readings in variants.\n"
    "- Variants should be distinct product-category phrases, not synonyms."
)


def _llm_canonical_call(topic: str) -> str:
    """Call the configured LLM to canonicalize the topic. Returns raw JSON text.

    Raises on provider errors — callers must catch. Extracted so tests can
    monkeypatch it without actually hitting a model.
    """
    from ..analyze.providers.base import get_provider

    provider = get_provider()  # uses resolve_provider() internally
    return provider.complete(
        prompt=_CANONICAL_PROMPT_USER.format(topic=topic),
        system=_CANONICAL_PROMPT_SYSTEM,
        max_tokens=200,
        temperature=0.1,
    )


def _load_canonical(topic: str) -> dict | None:
    """Read a cached canonicalization result, if any."""
    import json
    from ..core.db import get_db

    db = get_db()
    if "topic_canonicalizations" not in db.table_names():
        return None
    rows = list(db.query(
        "SELECT canonical, variants_json, confidence FROM topic_canonicalizations "
        "WHERE original = ?",
        [topic.strip().lower()],
    ))
    if not rows:
        return None
    r = rows[0]
    try:
        variants = json.loads(r["variants_json"])
    except Exception:
        variants = []
    return {
        "canonical": r["canonical"],
        "variants": variants,
        "confidence": r["confidence"],
    }


def _cache_canonical(topic: str, result: dict) -> None:
    """Persist the result. Uses `original` as PK so upserts replace cleanly."""
    import json
    from datetime import datetime, timezone
    from ..core.db import get_db

    db = get_db()
    db["topic_canonicalizations"].upsert(
        {
            "original": topic.strip().lower(),
            "canonical": result.get("canonical") or topic,
            "variants_json": json.dumps(result.get("variants") or []),
            "confidence": result.get("confidence") or "unknown",
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        pk="original",
    )


def _canonicalize_topic(topic: str) -> dict[str, Any]:
    """Return a canonical form + variants + confidence for a topic.

    Flow:
      1. Check sqlite cache — return immediately on hit.
      2. If no LLM is configured, return {canonical=topic, variants=[], unknown}.
      3. Call LLM with a small prompt; parse JSON defensively.
      4. Cache and return.

    Never raises. Any failure degrades to passthrough with confidence="unknown".
    """
    import json as _json

    topic = (topic or "").strip()
    if not topic:
        return {"canonical": topic, "variants": [], "confidence": "unknown"}

    cached = _load_canonical(topic)
    if cached is not None:
        return cached

    # Resolve provider; passthrough if no LLM.
    try:
        from ..analyze.providers.base import resolve_provider
        resolve_provider(None)
    except Exception:
        return {"canonical": topic, "variants": [], "confidence": "unknown"}

    try:
        raw = _llm_canonical_call(topic)
    except Exception:
        return {"canonical": topic, "variants": [], "confidence": "unknown"}

    # Defensive parse — strip markdown fences, try JSON, else passthrough.
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        # Drop a possible "json\n" language marker.
        if text.lstrip().lower().startswith("json"):
            text = text.split("\n", 1)[1] if "\n" in text else ""
    try:
        parsed = _json.loads(text)
    except Exception:
        return {"canonical": topic, "variants": [], "confidence": "unknown"}

    canonical = (parsed.get("canonical") or topic).strip()
    variants = [v for v in (parsed.get("variants") or []) if isinstance(v, str) and v.strip()]
    confidence = parsed.get("confidence") or "unknown"
    if confidence not in ("high", "low", "unknown"):
        confidence = "unknown"

    result = {"canonical": canonical, "variants": variants, "confidence": confidence}
    try:
        _cache_canonical(topic, result)
    except Exception:
        pass  # caching is best-effort; never block the flow
    return result


def discover_subs(topic: str, limit: int = 10) -> list[dict[str, Any]]:
    """Return top-N relevant subs for a topic, best-first."""
    tokens = _tokens(topic)
    seen: dict[str, dict[str, Any]] = {}

    # Try exact query first
    for s in _search_raw(topic):
        seen[s.get("display_name", "").lower()] = s

    # If that was thin, search each non-stopword term and merge
    if len(seen) < 8 and tokens:
        for t in tokens:
            for s in _search_raw(t):
                key = s.get("display_name", "").lower()
                if key and key not in seen:
                    seen[key] = s

    # Filter: public only, not NSFW
    candidates = [
        s
        for s in seen.values()
        if not s.get("over18") and s.get("subreddit_type") == "public"
    ]
    ranked = sorted(candidates, key=lambda s: _rank_score(s, tokens), reverse=True)

    out: list[dict[str, Any]] = []
    for s in ranked[:limit]:
        out.append(
            {
                "name": s.get("display_name"),
                "title": s.get("title"),
                "subscribers": s.get("subscribers"),
                "description": (s.get("public_description") or "").strip()[:200],
                "url": f"https://www.reddit.com/r/{s.get('display_name')}",
                "relevance": round(_relevance_bonus(s, tokens), 2),
            }
        )
    return out
