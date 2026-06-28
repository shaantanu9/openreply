"""ProductHunt via their GraphQL API v2. Free developer tier.

1. Register an app: https://api.producthunt.com/v2/oauth/applications
2. Get a developer token (client_credentials or OAuth token)
3. Set PH_TOKEN in env

Without the token, degrades gracefully to an empty list with a hint.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import httpx

_API = "https://api.producthunt.com/v2/api/graphql"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _token() -> str | None:
    return os.getenv("PH_TOKEN") or None


def _row(p: dict[str, Any]) -> dict[str, Any]:
    try:
        ts = datetime.fromisoformat((p.get("createdAt") or "").replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        ts = 0.0
    return {
        "id": f"ph_{p.get('id')}",
        "sub": "producthunt",
        "source_type": "producthunt",
        "author": (p.get("user") or {}).get("username") or "[anon]",
        "title": (p.get("name") or "")[:200],
        "selftext": (p.get("tagline") or "") + "\n\n" + (p.get("description") or ""),
        "url": p.get("website") or p.get("url") or "",
        "score": int(p.get("votesCount") or 0),
        "upvote_ratio": None,
        "num_comments": int(p.get("commentsCount") or 0),
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": ",".join([t.get("name", "") for t in (p.get("topics") or {}).get("nodes", [])][:3]),
        "permalink": p.get("url"),
        "fetched_at": _now_iso(),
    }


def fetch_producthunt(query: str, limit: int = 20) -> list[dict]:
    tok = _token()
    if not tok:
        return [{"_error": "PH_TOKEN not set — register at api.producthunt.com/v2/oauth/applications"}]
    q = """
    query($first:Int!, $q:String!) {
      posts(first: $first, order: RANKING, postedAfter: null) {
        nodes {
          id name tagline description votesCount commentsCount createdAt url website
          user { username }
          topics { nodes { name } }
        }
      }
    }
    """
    try:
        r = httpx.post(
            _API,
            headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
            json={"query": q, "variables": {"first": min(50, limit), "q": query}},
            timeout=20,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    nodes = ((r.json() or {}).get("data") or {}).get("posts", {}).get("nodes") or []
    # Client-side filter by query since ProductHunt's GraphQL `posts` doesn't
    # support a free-text filter without the specific makerProjects scope.
    ql = query.lower()
    filtered = [
        n for n in nodes
        if ql in (n.get("name") or "").lower()
        or ql in (n.get("tagline") or "").lower()
        or ql in (n.get("description") or "").lower()
    ]
    return [_row(n) for n in filtered[:limit]]
