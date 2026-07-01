"""Mastodon public search. Per-instance; defaults to mastodon.social.

Public read doesn't need auth. https://docs.joinmastodon.org/methods/search/
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import httpx

_DEFAULT = "mastodon.social"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s or "")


def _row(p: dict[str, Any], instance: str) -> dict[str, Any]:
    acct = p.get("account") or {}
    try:
        ts = datetime.fromisoformat((p.get("created_at") or "").replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        ts = 0.0
    return {
        "id": f"mastodon_{instance}_{p.get('id')}",
        "sub": f"mastodon:{instance}",
        "source_type": "mastodon",
        "author": acct.get("acct") or acct.get("username") or "[anon]",
        # Toots have no title — derive a short one from the content so the
        # post never surfaces with a blank title in the UI / opportunities.
        "title": (lambda s: (s[:80] + "…") if len(s) > 80 else s)(" ".join(_strip_html(p.get("content") or "").split())),
        "selftext": _strip_html(p.get("content") or "")[:2000],
        "url": p.get("url") or "",
        "score": int(p.get("favourites_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(p.get("replies_count") or 0),
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": int(bool(p.get("sensitive"))),
        "flair": None,
        "permalink": p.get("url") or "",
        "fetched_at": _now_iso(),
    }


def fetch_mastodon(query: str, instance: str = _DEFAULT, limit: int = 30) -> list[dict]:
    """Public search.

    Mastodon's unauth search for *statuses* returns empty (privacy feature).
    Workaround: treat the query as a hashtag and hit the public
    `/api/v1/timelines/tag/<tag>` endpoint — works without auth.
    """
    # Build a tag from the query (strip spaces/punct, lowercase)
    tag = re.sub(r"[^a-zA-Z0-9]", "", (query or "").replace("#", "")).lower()[:50]
    if not tag:
        return []
    try:
        r = httpx.get(
            f"https://{instance}/api/v1/timelines/tag/{tag}",
            params={"limit": min(40, limit)},
            timeout=20,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    statuses = r.json() or []
    return [_row(s, instance) for s in statuses[:limit]]
