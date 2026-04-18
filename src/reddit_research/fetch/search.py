"""Reddit search — sub-scoped or all of Reddit."""
from __future__ import annotations

from typing import Literal

from ..core.client import get_reddit
from ..core.db import log_fetch_end, log_fetch_start, upsert_posts
from ._shape import post_row

Sort = Literal["relevance", "hot", "new", "top", "comments"]
TimeFilter = Literal["hour", "day", "week", "month", "year", "all"]


def search_reddit(
    query: str,
    sub: str | None = None,
    sort: Sort = "relevance",
    time_filter: TimeFilter = "all",
    limit: int = 50,
    save: bool = True,
) -> list[dict]:
    fetch_id = log_fetch_start(
        "search",
        {"query": query, "sub": sub, "sort": sort, "time_filter": time_filter, "limit": limit},
    )
    try:
        reddit = get_reddit()
        target = reddit.subreddit(sub) if sub else reddit.subreddit("all")
        results = target.search(query, sort=sort, time_filter=time_filter, limit=limit)
        rows = [post_row(p) for p in results]
        if save:
            upsert_posts(rows)
        log_fetch_end(fetch_id, rows=len(rows))
        return rows
    except Exception as e:
        log_fetch_end(fetch_id, rows=0, error=str(e))
        raise
