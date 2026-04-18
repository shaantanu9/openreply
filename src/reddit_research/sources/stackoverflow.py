"""Stack Overflow search via StackExchange API. Free, optional key for higher quota.

https://api.stackexchange.com/docs/search
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import httpx

_BASE = "https://api.stackexchange.com/2.3"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(q: dict[str, Any]) -> dict[str, Any]:
    owner = q.get("owner") or {}
    tags = q.get("tags") or []
    return {
        "id": f"so_{q.get('question_id')}",
        "sub": "stackoverflow",
        "source_type": "stackoverflow",
        "author": owner.get("display_name") or "[anon]",
        "title": q.get("title") or "",
        "selftext": (q.get("body") or "")[:2000] if q.get("body") else "",
        "url": q.get("link") or "",
        "score": int(q.get("score") or 0),
        "upvote_ratio": None,
        "num_comments": int(q.get("answer_count") or 0),
        "created_utc": float(q.get("creation_date") or 0),
        "is_self": 1,
        "over_18": 0,
        "flair": ",".join(tags[:3]) if tags else None,
        "permalink": q.get("link"),
        "fetched_at": _now_iso(),
    }


def fetch_stackoverflow(
    query: str | None = None,
    tag: str | None = None,
    limit: int = 50,
    sort: str = "votes",  # votes|activity|creation|relevance
    site: str = "stackoverflow",
    accepted_only: bool = False,
) -> list[dict]:
    """Search SO. Give `query` for free-text, `tag` for strict tag match, or both."""
    if not query and not tag:
        return []
    endpoint = "/search/advanced"
    # Note: default SE filter omits question body. For full body pass a filter
    # id created via the filter-creation endpoint; titles/scores/tags are in
    # the default response which is sufficient for gap-mining.
    params: dict[str, Any] = {
        "site": site, "sort": sort, "order": "desc", "pagesize": min(100, limit),
    }
    if query:
        params["q"] = query
    if tag:
        params["tagged"] = tag
    if accepted_only:
        params["accepted"] = "True"

    collected: list[dict] = []
    page = 1
    while len(collected) < limit:
        params["page"] = page
        try:
            r = httpx.get(f"{_BASE}{endpoint}", params=params, timeout=20)
            if r.status_code == 429:
                time.sleep(2)
                continue
            r.raise_for_status()
        except httpx.HTTPError:
            break
        data = r.json() or {}
        items = data.get("items") or []
        if not items:
            break
        collected.extend(_row(q) for q in items)
        if not data.get("has_more"):
            break
        page += 1
        if data.get("backoff"):
            time.sleep(float(data["backoff"]))
        else:
            time.sleep(0.5)
    return collected[:limit]
