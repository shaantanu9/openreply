"""ProductHunt via their GraphQL API v2. Free developer tier.

1. Register an app: https://api.producthunt.com/v2/oauth/applications
2. Get a developer token (client_credentials or OAuth token)
3. Set PH_TOKEN in env

Without the token, degrades gracefully to an empty list with a hint.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from ._http import DEFAULT_HEADERS

_API = "https://api.producthunt.com/v2/api/graphql"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _token() -> str | None:
    return os.getenv("PH_TOKEN") or None


def _topic_names(p: dict[str, Any]) -> list[str]:
    topics = p.get("topics") or {}
    edges = topics.get("edges") if isinstance(topics, dict) else []
    names = []
    for edge in (edges or []):
        if not isinstance(edge, dict):
            continue
        node = edge.get("node") or {}
        name = node.get("name") if isinstance(node, dict) else None
        if name:
            names.append(str(name))
    return names


def _row(p: dict[str, Any]) -> dict[str, Any]:
    try:
        ts = datetime.fromisoformat((p.get("createdAt") or "").replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError, TypeError):
        ts = 0.0
    user = p.get("user") or {}
    tagline = (p.get("tagline") or "").strip()
    description = (p.get("description") or "").strip()
    body = (tagline + "\n\n" + description).strip() if (tagline and description) else (tagline or description)
    return {
        "id": f"ph_{p.get('id')}",
        "sub": "producthunt",
        "source_type": "producthunt",
        "author": user.get("username") or "[anon]",
        "title": (p.get("name") or "")[:200],
        "selftext": body,
        "url": p.get("website") or p.get("url") or "",
        "score": int(p.get("votesCount") or 0),
        "upvote_ratio": None,
        "num_comments": int(p.get("commentsCount") or 0),
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": ",".join(_topic_names(p)[:3]),
        "permalink": p.get("url") or "",
        "fetched_at": _now_iso(),
    }


def fetch_producthunt(query: str, limit: int = 20, days_back: int = 30) -> list[dict]:
    tok = _token()
    if not tok:
        return [{"_error": "PH_TOKEN not set — register at api.producthunt.com/v2/oauth/applications"}]

    # Product Hunt's public GraphQL schema is Relay-style: edges { node { ... } }.
    # The `posts` field does not support free-text search, so we fetch recent
    # launches and filter client-side.
    posted_after = datetime.fromtimestamp(time.time() - days_back * 86400, tz=timezone.utc).isoformat()
    q = """
    query($first:Int!, $postedAfter:DateTime!) {
      posts(first: $first, order: NEWEST, postedAfter: $postedAfter) {
        edges {
          node {
            id name tagline description votesCount commentsCount createdAt url website
            user { username }
            topics { edges { node { name } } }
          }
        }
      }
    }
    """
    try:
        r = httpx.post(
            _API,
            headers={**DEFAULT_HEADERS, "Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
            json={"query": q, "variables": {"first": min(50, max(limit, 10)), "postedAfter": posted_after}},
            timeout=20,
        )
        r.raise_for_status()
    except httpx.HTTPError as e:
        return [{"_error": f"Product Hunt HTTP error: {e}"}]

    try:
        payload = r.json() or {}
    except Exception as e:
        return [{"_error": f"Product Hunt response decode error: {e}"}]
    if payload.get("errors"):
        msgs = "; ".join(str(e.get("message")) for e in payload["errors"])
        return [{"_error": f"Product Hunt GraphQL error: {msgs}"}]

    edges = ((payload.get("data") or {}).get("posts", {}).get("edges")) or []
    nodes = [e.get("node") for e in edges if isinstance(e, dict) and isinstance(e.get("node"), dict)]
    ql = (query or "").lower().strip()
    if ql:
        filtered = [
            n for n in nodes
            if ql in (n.get("name") or "").lower()
            or ql in (n.get("tagline") or "").lower()
            or ql in (n.get("description") or "").lower()
            or any(ql in t.lower() for t in _topic_names(n))
        ]
    else:
        filtered = nodes
    return [_row(n) for n in filtered[:limit]]
