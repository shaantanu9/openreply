"""GitHub — trending repos + stars-history-ish signals, keyless where possible.

For search, GitHub's public REST API allows 60 req/h unauth, 5000/h with token.
We rely on anonymous search here, limited to surface-level. See github_issues.py
for authenticated Issues search.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import httpx

_API = "https://api.github.com"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _headers() -> dict[str, str]:
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    token = os.getenv("GITHUB_TOKEN")
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _row(r: dict[str, Any]) -> dict[str, Any]:
    try:
        ts = datetime.fromisoformat((r.get("created_at") or "").replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        ts = 0.0
    return {
        "id": f"gh_{r.get('id')}",
        "sub": "github",
        "source_type": "github",
        "author": (r.get("owner") or {}).get("login") or "",
        "title": (r.get("full_name") or "")[:200],
        "selftext": (r.get("description") or "")[:1500],
        "url": r.get("html_url") or "",
        "score": int(r.get("stargazers_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(r.get("open_issues_count") or 0),
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": r.get("language"),
        "permalink": r.get("html_url"),
        "fetched_at": _now_iso(),
    }


def search_github_repos(query: str, limit: int = 20, sort: str = "stars") -> list[dict]:
    """Search GitHub repos by keyword, sorted by stars (default)."""
    try:
        r = httpx.get(
            f"{_API}/search/repositories",
            params={"q": query, "sort": sort, "per_page": min(100, limit)},
            headers=_headers(),
            timeout=20,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    items = (r.json() or {}).get("items") or []
    return [_row(i) for i in items[:limit]]
