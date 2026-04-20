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
    "You validate a user's topic string AND expand it into a search-keyword "
    "set. Return the canonical form (with typo correction), alternative "
    "interpretations, and 5-8 scored search keywords useful for querying "
    "Reddit, academic search engines, HN, and app stores. Return JSON only."
)
_CANONICAL_PROMPT_USER = (
    "Topic: \"{topic}\"\n\n"
    "Return JSON matching:\n"
    "{{\n"
    "  \"canonical\": \"<best guess>\",\n"
    "  \"variants\": [\"<alt1>\", \"<alt2>\"],\n"
    "  \"confidence\": \"high\" | \"low\",\n"
    "  \"search_keywords\": ["
    "{{\"keyword\": \"<term>\", \"relevance\": \"high\" | \"medium\" | \"low\"}}"
    ", ...]\n"
    "}}\n\n"
    "Rules:\n"
    "- Include the canonical itself as the FIRST keyword (relevance high).\n"
    "- 5-8 keywords total. Each 1-4 words. No duplicates.\n"
    "- high: a searcher would definitely use this term.\n"
    "- medium: related, plausibly useful.\n"
    "- low: tangentially related.\n"
    "- Include common product names that dominate the domain.\n"
    "- If the topic looks correct, confidence 'high' + 2 variants.\n"
    "- If a typo is obvious (e.g. 'calari' → 'calorie'), fix it + confidence 'high'.\n"
    "- If genuinely ambiguous, confidence 'low' + variants span distinct readings."
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
        max_tokens=400,  # was 200 — room for the added search_keywords block
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
        "SELECT canonical, variants_json, confidence, "
        "COALESCE(keywords_json, '') AS keywords_json "
        "FROM topic_canonicalizations WHERE original = ?",
        [topic.strip().lower()],
    ))
    if not rows:
        return None
    r = rows[0]
    try:
        variants = json.loads(r["variants_json"])
    except Exception:
        variants = []
    try:
        search_keywords = json.loads(r["keywords_json"]) if r["keywords_json"] else []
    except Exception:
        search_keywords = []
    # Stale cache from before keywords were introduced → force a re-LLM.
    if not search_keywords:
        return None
    return {
        "canonical": r["canonical"],
        "variants": variants,
        "confidence": r["confidence"],
        "search_keywords": search_keywords,
    }


def _cache_canonical(topic: str, result: dict) -> None:
    """Persist the result. Uses `original` as PK so upserts replace cleanly.

    Silently skips the write if the schema hasn't been initialized yet —
    symmetric with _load_canonical. init_schema() creates the table at
    app startup, so this guard is belt-and-suspenders for stale DBs.
    """
    import json
    from datetime import datetime, timezone
    from ..core.db import get_db

    db = get_db()
    if "topic_canonicalizations" not in db.table_names():
        return
    db["topic_canonicalizations"].upsert(
        {
            "original": topic.strip().lower(),
            "canonical": result.get("canonical") or topic,
            "variants_json": json.dumps(result.get("variants") or []),
            "confidence": result.get("confidence") or "unknown",
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "keywords_json": json.dumps(result.get("search_keywords") or []),
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
        return {"canonical": topic, "variants": [], "confidence": "unknown",
                "search_keywords": []}

    cached = _load_canonical(topic)
    if cached is not None:
        return cached

    # Gate the LLM call behind a provider check. We only care whether ANY
    # provider is resolvable right now — the return value is ignored because
    # _llm_canonical_call() will resolve again (lazily) at call time. If
    # nothing is configured, resolve_provider raises → fall back to passthrough
    # so collect flows still work without an API key.
    try:
        from ..analyze.providers.base import resolve_provider
        _ = resolve_provider(None)
    except Exception:
        return {"canonical": topic, "variants": [], "confidence": "unknown",
                "search_keywords": []}

    try:
        raw = _llm_canonical_call(topic)
    except Exception:
        return {"canonical": topic, "variants": [], "confidence": "unknown",
                "search_keywords": []}

    # Defensive parse — LLMs sometimes wrap JSON in markdown fences or prose.
    # We try JSON as-is first; on failure, strip fences; on failure, extract
    # the first {...} block via regex. Any parse failure → passthrough.
    import re as _re
    text = (raw or "").strip()
    parsed = None
    for attempt in (
        lambda: _json.loads(text),
        lambda: _json.loads(text.strip("`").lstrip("json").strip()),
        lambda: _json.loads(
            _re.search(r"\{.*\}", text, _re.DOTALL).group(0)
            if _re.search(r"\{.*\}", text, _re.DOTALL) else ""
        ),
    ):
        try:
            parsed = attempt()
            if isinstance(parsed, dict):
                break
            parsed = None
        except Exception:
            continue
    if not isinstance(parsed, dict):
        return {"canonical": topic, "variants": [], "confidence": "unknown",
                "search_keywords": []}

    canonical = (parsed.get("canonical") or topic).strip()
    variants = [v for v in (parsed.get("variants") or []) if isinstance(v, str) and v.strip()]
    confidence = parsed.get("confidence") or "unknown"
    if confidence not in ("high", "low", "unknown"):
        confidence = "unknown"

    # Parse + normalize search_keywords. Drop malformed entries silently.
    raw_keywords = parsed.get("search_keywords") or []
    search_keywords: list[dict] = []
    seen_kw: set[str] = set()
    for kw in raw_keywords:
        if not isinstance(kw, dict):
            continue
        k = str(kw.get("keyword") or "").strip()
        rel = str(kw.get("relevance") or "low").strip().lower()
        if not k or rel not in ("high", "medium", "low"):
            continue
        if k.lower() in seen_kw:
            continue
        seen_kw.add(k.lower())
        search_keywords.append({"keyword": k, "relevance": rel})
    # Always ensure the canonical appears in the keyword list.
    if search_keywords and canonical.lower() not in seen_kw:
        search_keywords.insert(0, {"keyword": canonical, "relevance": "high"})

    result = {
        "canonical": canonical,
        "variants": variants,
        "confidence": confidence,
        "search_keywords": search_keywords,
    }
    try:
        _cache_canonical(topic, result)
    except Exception:
        pass  # caching is best-effort; never block the flow
    return result


def discover_subs(topic: str, limit: int = 10) -> dict[str, Any]:
    """Return top-N relevant subs for a topic plus a confirmation payload.

    Return shape:
        {
            "subs": list[dict],                # same shape as before
            "confirmation": {
                "original_topic": str,
                "canonical_topic": str,
                "auto_corrected": bool,
                "needs_confirmation": bool,
                "suggested_variants": list[str],
                "reason": str,                 # see reason codes below
            },
        }

    Reason codes:
      - "direct_match"                       — no correction, strong matches
      - "high_confidence_typo_correction"    — corrected silently
      - "low_confidence_canonicalization"    — LLM was unsure → confirm
      - "weak_sub_relevance"                 — no strong name matches → confirm
      - "canonicalization_unavailable"       — no LLM; falls back silently
    """
    canon = _canonicalize_topic(topic)
    canonical_topic = canon["canonical"] or topic
    auto_corrected = (
        canon["confidence"] != "unknown"
        and canonical_topic.strip().lower() != (topic or "").strip().lower()
    )

    # Search against the canonical form first, then widen the net using the
    # LLM-expanded keyword set (high + medium relevance). Each keyword is a
    # short natural-language phrase ("sleep tracker", "wearable ring") —
    # strictly broader than the fallback single-token search below. Union
    # all three sources so the downstream ranker has ~3× the candidate pool.
    tokens = _tokens(canonical_topic)
    seen: dict[str, dict[str, Any]] = {}
    for s in _search_raw(canonical_topic):
        seen[s.get("display_name", "").lower()] = s

    # LLM keyword sweep — skip when canonicalization is unavailable
    # (no LLM configured) or returned an empty keyword list.
    llm_kws = [
        str(k.get("keyword") or "").strip()
        for k in (canon.get("search_keywords") or [])
        if k.get("relevance") in ("high", "medium") and str(k.get("keyword") or "").strip()
    ]
    # Skip the canonical itself (already queried above) to avoid wasted calls.
    llm_kws = [k for k in llm_kws if k.lower() != canonical_topic.strip().lower()]
    # Cap at 6 — Reddit's /subreddits/search is lightly rate-limited and
    # returns diminishing marginal subs per extra query beyond ~6.
    for kw in llm_kws[:6]:
        for s in _search_raw(kw):
            key = s.get("display_name", "").lower()
            if key and key not in seen:
                seen[key] = s

    # Legacy single-token fallback — only needed if we STILL have too few.
    if len(seen) < 8 and tokens:
        for t in tokens:
            for s in _search_raw(t):
                key = s.get("display_name", "").lower()
                if key and key not in seen:
                    seen[key] = s

    candidates = [
        s for s in seen.values()
        if not s.get("over18") and s.get("subreddit_type") == "public"
    ]
    ranked = sorted(candidates, key=lambda s: _rank_score(s, tokens), reverse=True)

    subs: list[dict[str, Any]] = []
    for s in ranked[:limit]:
        subs.append(
            {
                "name": s.get("display_name"),
                "title": s.get("title"),
                "subscribers": s.get("subscribers"),
                "description": (s.get("public_description") or "").strip()[:200],
                "url": f"https://www.reddit.com/r/{s.get('display_name')}",
                "relevance": round(_relevance_bonus(s, tokens), 2),
            }
        )

    # Weakness check — "no discovered sub has a token in its name AND all
    # top-3 bonuses are below 0.5" means users probably fell through to
    # generic-keyword-fallback hell (e.g. "tracking" matched flight subs).
    any_name_match = any(
        any(t in (s["name"] or "").lower() for t in tokens)
        for s in subs
    )
    top3_weak = all((s.get("relevance") or 0.0) < 0.5 for s in subs[:3])
    weak = (not any_name_match) and top3_weak and len(subs) > 0

    # Decide reason + needs_confirmation.
    if canon["confidence"] == "low":
        reason = "low_confidence_canonicalization"
        needs_confirmation = True
    elif weak:
        reason = "weak_sub_relevance"
        needs_confirmation = True
    elif canon["confidence"] == "unknown":
        reason = "canonicalization_unavailable"
        needs_confirmation = False
    elif auto_corrected:
        reason = "high_confidence_typo_correction"
        needs_confirmation = False
    else:
        reason = "direct_match"
        needs_confirmation = False

    return {
        "subs": subs,
        "confirmation": {
            "original_topic": topic,
            "canonical_topic": canonical_topic,
            "auto_corrected": auto_corrected,
            "needs_confirmation": needs_confirmation,
            "suggested_variants": canon.get("variants", []),
            "reason": reason,
        },
    }
