"""Lemmy — federated Reddit alternative. Public JSON API per instance.

Default instance: lemmy.world (largest). Override via `instance=` arg.
https://join-lemmy.org/api/
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

_DEFAULT = "lemmy.world"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(p: dict[str, Any], instance: str) -> dict[str, Any]:
    post = p.get("post") or {}
    counts = p.get("counts") or {}
    community = p.get("community") or {}
    creator = p.get("creator") or {}
    try:
        ts = datetime.fromisoformat((post.get("published") or "").replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        ts = 0.0
    community_name = community.get("name") or "?"
    return {
        "id": f"lemmy_{instance}_{post.get('id')}",
        "sub": f"lemmy:{community_name}",
        "source_type": "lemmy",
        "author": creator.get("name") or "[anon]",
        "title": (post.get("name") or "")[:300],
        "selftext": (post.get("body") or "")[:2000],
        "url": post.get("url") or "",
        "score": int(counts.get("score") or 0),
        "upvote_ratio": None,
        "num_comments": int(counts.get("comments") or 0),
        "created_utc": float(ts),
        "is_self": int(not bool(post.get("url"))),
        "over_18": int(bool(post.get("nsfw"))),
        "flair": community_name,
        "permalink": f"https://{instance}/post/{post.get('id')}",
        "fetched_at": _now_iso(),
    }


def fetch_lemmy(
    query: str,
    instance: str = _DEFAULT,
    limit: int = 30,
    type_: str = "Posts",   # Posts | Comments | Communities | Users
    sort: str = "TopAll",   # Active | Hot | New | TopAll | TopYear | TopMonth
) -> list[dict]:
    try:
        r = httpx.get(
            f"https://{instance}/api/v3/search",
            params={"q": query, "type_": type_, "sort": sort, "limit": min(50, limit)},
            timeout=20,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    data = r.json() or {}
    posts = data.get("posts") or []
    return [_row(p, instance) for p in posts[:limit]]
