"""AI-derived search keywords for an agent.

The reply engine scans Reddit + connected platforms for discussions worth
engaging. Historically it searched the agent's literal ``keywords`` and fell
back to the agent NAME when none were set — so an agent named "textnote"
searched the literal string "textnote" and surfaced irrelevant junk (random
mentions of "text note") instead of the conversations its audience actually
has.

This module turns the agent's IDENTITY (name, niche, product, goal, audience)
into a rich, scored set of the search terms its audience would really use — via
the configured BYOK LLM, cached per-agent in ``reply_state`` so it costs one
call until the identity changes. When no LLM is configured it falls back to
identity-derived terms (never the bare agent name alone).
"""
from __future__ import annotations

import hashlib
import json
import re
import time

from .schema import init_reply_schema
from .util import loads_json

_SYS = (
    "You turn a brand/creator identity into the search terms its audience uses "
    "on Reddit, X, Hacker News and forums. Focus on the PROBLEMS the product "
    "solves and the TOPICS the audience discusses — NOT the brand's own name. "
    "Return JSON only."
)

_USER = (
    "IDENTITY\n"
    "name: {name}\n"
    "niche: {niche}\n"
    "product: {product}\n"
    "goal: {goal}\n"
    "audience: {audience}\n\n"
    'Return JSON: {{"keywords": [{{"term": "<1-4 words>", "relevance": "high|medium|low"}}, ...]}}\n'
    "Rules:\n"
    "- 8-14 terms. Each 1-4 words. Lowercase. No duplicates.\n"
    "- Terms the AUDIENCE searches or posts: problems, use-cases, alternatives, category names.\n"
    "- DO NOT include the brand's own name unless it is also a generic category term.\n"
    "- high: core to the agent's space; medium: clearly adjacent; low: tangential."
)

# Common filler that makes a poor standalone search term in the no-LLM fallback.
_STOP = {
    "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "that",
    "this", "your", "you", "our", "we", "app", "apps", "tool", "tools", "platform",
    "software", "solution", "service", "helps", "help", "make", "made", "best",
    "use", "using", "users", "people", "is", "are", "be", "it", "their", "them",
}


def _identity_text(a: dict) -> str:
    parts = [
        a.get("niche") or a.get("description"),
        a.get("product"),
        a.get("goal"),
        a.get("audience"),
        a.get("name"),
    ]
    return " | ".join(str(p) for p in parts if p)


def _identity_hash(a: dict) -> str:
    return hashlib.sha1(_identity_text(a).lower().encode("utf-8")).hexdigest()[:12]


def _cache_key(aid: str, h: str) -> str:
    return f"kwexp:{aid}:{h}"


def _cached(aid: str, h: str) -> list[str] | None:
    db = init_reply_schema()
    try:
        row = db["reply_state"].get(_cache_key(aid, h))
        if row:
            data = json.loads(dict(row)["value"])
            return data.get("keywords") or None
    except Exception:
        pass
    return None


def _store(aid: str, h: str, kws: list[str]) -> None:
    db = init_reply_schema()
    try:
        db["reply_state"].upsert(
            {"key": _cache_key(aid, h),
             "value": json.dumps({"keywords": kws, "ts": int(time.time())})},
            pk="key",
        )
    except Exception:
        pass


def _fallback_terms(a: dict) -> list[str]:
    """No LLM available: derive terms from the identity text — WITHOUT the bare
    name as a standalone term. Keeps short descriptive phrases (niche/product)
    plus de-stopped single words so search is still topical, not literal-name."""
    terms: list[str] = []
    # Whole short phrases first (e.g. "note taking", "calorie tracker").
    for chunk in (a.get("niche") or a.get("description"), a.get("product"), a.get("audience")):
        c = (chunk or "").strip().lower()
        if c and 2 <= len(c) <= 40 and c not in terms:
            terms.append(c)
    # Then meaningful single words across the whole identity.
    text = " ".join(str(p) for p in (a.get("niche") or a.get("description"),
                                     a.get("product"), a.get("goal"), a.get("audience")) if p)
    for w in re.findall(r"[a-z][a-z0-9+#-]{2,}", text.lower()):
        if w not in _STOP and w not in terms:
            terms.append(w)
    return terms[:10]


def _merge(seed: list[str], expanded: list[str], cap: int) -> list[str]:
    out: list[str] = []
    for term in [*seed, *expanded]:
        t = (term or "").strip()
        if t and t.lower() not in {o.lower() for o in out}:
            out.append(t)
    return out[:cap]


def agent_search_keywords(agent: dict, *, provider: str | None = None,
                          max_terms: int = 12, min_relevance: str = "medium",
                          refresh: bool = False) -> list[str]:
    """Search terms used to discover engageable posts for this agent.

    Blends the agent's explicitly-set ``keywords`` (kept as a high-signal seed)
    with LLM-expanded topic terms derived from the agent's full identity. The
    LLM result is cached per (agent, identity) in ``reply_state`` so it costs one
    call until the identity changes. The bare agent name is never used as a
    standalone term. Returns ``[]`` only when the agent has no identity at all.
    """
    a = dict(agent or {})
    # The brand projection (brand.py) drops goal/product/audience — hydrate the
    # full agent so the expansion sees the whole identity.
    if a.get("id") and ("goal" not in a or "product" not in a):
        try:
            from .agent import get_agent
            full = get_agent(a["id"])
            if full:
                a = {**full, **a}  # keep any caller overrides, add missing fields
        except Exception:
            pass

    name = (a.get("name") or "").strip().lower()
    # Explicit keywords are the seed — but a lone keyword equal to the name is
    # not a useful search term, so drop that case.
    seed = [k.strip() for k in (a.get("keywords") or []) if k and k.strip()]
    seed = [k for k in seed if k.lower() != name]

    h = _identity_hash(a)
    if not refresh:
        cached = _cached(a.get("id") or "default", h)
        if cached is not None:
            return _merge(seed, cached, max_terms)

    keep = {"high"} if min_relevance == "high" else \
        {"high", "medium"} if min_relevance == "medium" else {"high", "medium", "low"}
    rank = {"high": 0, "medium": 1, "low": 2}
    expanded: list[str] = []
    try:
        from ..analyze.providers.base import get_provider
        raw = get_provider(provider).complete(
            prompt=_USER.format(
                name=a.get("name", ""),
                niche=a.get("niche") or a.get("description") or "",
                product=a.get("product", ""),
                goal=a.get("goal", ""),
                audience=a.get("audience", ""),
            ),
            system=_SYS, max_tokens=400, temperature=0.2,
        )
        data = loads_json(raw) or {}
        items = sorted((data.get("keywords") or []),
                       key=lambda k: rank.get(str(k.get("relevance", "low")).lower(), 3))
        for it in items:
            term = str(it.get("term") or "").strip().lower()
            relv = str(it.get("relevance") or "low").lower()
            if term and relv in keep and term != name and term not in expanded:
                expanded.append(term)
    except Exception:
        expanded = []

    if expanded:
        _store(a.get("id") or "default", h, expanded)  # cache only real LLM output
    else:
        expanded = _fallback_terms(a)  # provider-less: topical, not literal-name

    return _merge(seed, expanded, max_terms)
