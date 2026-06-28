"""V2EX — public API (hot topics, client-side filtered by query). Zero-config.

V2EX is a Chinese developer/tech community. The public API
(`/api/topics/hot.json`) returns recent hot topics with title, content, node,
member and reply count — no key, no login. We filter the hot list by the query
client-side (the public API has no full-text search endpoint).

Ported from agent-reach `channels/v2ex.py` (MIT) into the OpenReply posts-row
contract. Never raises — any error returns [].
"""
from __future__ import annotations

from datetime import datetime, timezone

from ._http import polite_get

_HOT = "https://www.v2ex.com/api/topics/hot.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(it: dict) -> dict:
    node = it.get("node") or {}
    member = it.get("member") or {}
    return {
        "id": f"v2ex_{it.get('id') or (hash(it.get('url', '')) & 0xFFFFFFFF):x}",
        "sub": (node.get("name") or "v2ex")[:60],
        "source_type": "v2ex",
        "author": member.get("username") or "",
        "title": (it.get("title") or "")[:300],
        "selftext": (it.get("content") or "")[:2000],
        "url": it.get("url") or "",
        "score": 0,
        "upvote_ratio": None,
        "num_comments": int(it.get("replies") or 0),
        "created_utc": float(it.get("created") or 0.0),
        "is_self": 1,
        "over_18": 0,
        "flair": (node.get("title") or None),
        "permalink": None,
        "fetched_at": _now_iso(),
    }


def fetch_v2ex(query: str, limit: int = 50, **_) -> list[dict]:
    """Fetch V2EX hot topics, filtered by *query* (client-side). Never raises."""
    try:
        r = polite_get(_HOT)
        r.raise_for_status()
        items = r.json()
    except Exception:
        return []
    if not isinstance(items, list):
        return []
    rows = [_row(it) for it in items]
    q = (query or "").strip().lower()
    if q:
        matched = [x for x in rows if q in x["title"].lower() or q in x["selftext"].lower()]
        rows = matched or rows  # fall back to the full hot list if nothing matched
    return rows[:limit]
