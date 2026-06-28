"""GitHub Issues + Discussions search. Free API, requires GITHUB_TOKEN for
meaningful quotas (unauth = 60 req/h, with token = 5000 req/h).

Massively high signal for OSS products — every user complaint filed here.
Set GITHUB_TOKEN in your .env (any scope-less personal access token works).
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
    t = os.getenv("GITHUB_TOKEN")
    if t:
        h["Authorization"] = f"Bearer {t}"
    return h


def _row(i: dict[str, Any]) -> dict[str, Any]:
    try:
        ts = datetime.fromisoformat((i.get("created_at") or "").replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        ts = 0.0
    repo_url = (i.get("repository_url") or "").replace("https://api.github.com/repos/", "")
    return {
        "id": f"ghissue_{i.get('id')}",
        "sub": f"github:{repo_url}",
        "source_type": "github_issue",
        "author": (i.get("user") or {}).get("login") or "[anon]",
        "title": (i.get("title") or "")[:300],
        "selftext": (i.get("body") or "")[:2000] if i.get("body") else "",
        "url": i.get("html_url") or "",
        "score": int(i.get("reactions", {}).get("+1") or 0),  # thumbs-up count
        "upvote_ratio": None,
        "num_comments": int(i.get("comments") or 0),
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": ",".join([l.get("name", "") for l in (i.get("labels") or [])][:3]),
        "permalink": i.get("html_url"),
        "fetched_at": _now_iso(),
    }


def fetch_github_issues(
    query: str,
    state: str = "open",
    limit: int = 30,
    sort: str = "reactions-+1",   # reactions | comments | created | updated
) -> list[dict]:
    """Search GitHub issues + PRs. Ranks by 👍 reactions = user pain density."""
    q = f"{query} state:{state}" if state else query
    try:
        r = httpx.get(
            f"{_API}/search/issues",
            params={"q": q, "sort": sort, "order": "desc", "per_page": min(100, limit)},
            headers=_headers(),
            timeout=20,
        )
        if r.status_code == 403:
            return [{"_error": "github API rate-limited — set GITHUB_TOKEN"}]  # hint, not silent
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    items = (r.json() or {}).get("items") or []
    return [_row(i) for i in items[:limit] if "_error" not in i]
