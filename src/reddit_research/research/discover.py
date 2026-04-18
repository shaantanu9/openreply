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
