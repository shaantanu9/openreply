"""Engagement-weighted Reciprocal Rank Fusion (RRF) for reply opportunities.

Adapted from the last30days engine's `rank.ts` (RRF + engagement bonus) and tuned for
OpenReply: each opportunity already has an LLM/heuristic *base* score (relevance/intent/
fit). We add a log-scaled **engagement** signal, a **freshness** decay, and a per-platform
**RRF** term, then fuse them into a single `final` score so high-engagement, recent,
high-rank conversations float to the top.

    final = 0.55·base + 0.20·rrf + 0.15·engagement + 0.10·freshness
"""
from __future__ import annotations

import math
import time

# Source trust weights (RRF). Reddit is the strongest reply surface; news/web are weakest.
_PLATFORM_WEIGHTS = {
    "reddit_free": 1.0, "reddit": 1.0, "hn": 0.9, "x": 0.85, "linkedin": 0.85,
    "stackoverflow": 0.8, "devto": 0.8, "producthunt": 0.8, "discourse": 0.75,
    "threads": 0.75, "bluesky": 0.75, "instagram": 0.7, "tiktok": 0.7,
    "mastodon": 0.7, "lemmy": 0.7, "youtube": 0.7, "truthsocial": 0.7,
    "gnews": 0.6, "duckduckgo": 0.6, "rss_user": 0.6, "rss_tech_news": 0.6, "trends": 0.5,
}
_RRF_K = 60          # RRF dampening constant (same as last30days)
_LOOKBACK_DAYS = 30  # freshness window


def platform_weight(pf: str) -> float:
    return _PLATFORM_WEIGHTS.get(pf, 0.7)


def engagement_score(post: dict) -> float:
    """Log-scaled blend of upvotes/comments/likes/views → 0..1."""
    total = 0.0
    for k in ("score", "ups", "upvotes", "num_comments", "comments", "likes", "reactions", "points"):
        try:
            total += float(post.get(k) or 0)
        except (TypeError, ValueError):
            pass
    try:
        total += float(post.get("views") or post.get("view_count") or 0) / 100.0
    except (TypeError, ValueError):
        pass
    if total <= 0:
        return 0.0
    return round(min(1.0, math.log10(total + 1) / 4.0), 4)  # ~saturates near 10k


def freshness(post: dict, now: float | None = None) -> float:
    """Linear recency decay over the lookback window → 0..1. Unknown date = neutral-low."""
    now = now or time.time()
    try:
        ts = float(post.get("created_utc") or 0)
    except (TypeError, ValueError):
        ts = 0.0
    if ts <= 0:
        return 0.3
    age_days = max(0.0, (now - ts) / 86400.0)
    if age_days >= _LOOKBACK_DAYS:
        return 0.0
    return round(1.0 - age_days / _LOOKBACK_DAYS, 4)


def fuse_and_rank(cands: list[dict]) -> list[dict]:
    """In-place add `rrf` + `final` to each candidate, return sorted desc by `final`.

    Each candidate dict must carry: `platform`, `base` (0..1), `eng` (0..1), `fresh` (0..1).
    RRF: within each platform, rank by (base + 0.25·eng) desc; rrf = weight / (k + rank).
    The pool's RRF terms are normalized to 0..1 before fusion.
    """
    by_pf: dict[str, list[dict]] = {}
    for c in cands:
        by_pf.setdefault(c["platform"], []).append(c)
    for pf, items in by_pf.items():
        items.sort(key=lambda c: c["base"] + 0.25 * c["eng"], reverse=True)
        w = platform_weight(pf)
        for rank, c in enumerate(items, start=1):
            c["_rrf_raw"] = w / (_RRF_K + rank)
    mx = max((c["_rrf_raw"] for c in cands), default=0.0) or 1.0
    for c in cands:
        rrf_n = c.pop("_rrf_raw") / mx
        c["rrf"] = round(rrf_n, 4)
        c["final"] = round(
            0.55 * c["base"] + 0.20 * rrf_n + 0.15 * c["eng"] + 0.10 * c["fresh"], 4
        )
    cands.sort(key=lambda c: c["final"], reverse=True)
    return cands
