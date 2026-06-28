"""Reddit search — sub-scoped or all of Reddit. Works in both auth and public mode."""
from __future__ import annotations

from typing import Literal

from ..core.config import load_config
from ..core.db import log_fetch_end, log_fetch_start, upsert_posts

Sort = Literal["relevance", "hot", "new", "top", "comments"]
TimeFilter = Literal["hour", "day", "week", "month", "year", "all"]


def _search_auth(query: str, sub: str | None, sort: str, time_filter: str, limit: int) -> list[dict]:
    from ..core.client import get_reddit
    from ._shape import post_row

    reddit = get_reddit()
    target = reddit.subreddit(sub) if sub else reddit.subreddit("all")
    return [post_row(p) for p in target.search(query, sort=sort, time_filter=time_filter, limit=limit)]


def _search_public(query: str, sub: str | None, sort: str, time_filter: str, limit: int) -> list[dict]:
    from ..core.public_client import public_search

    return public_search(query=query, sub=sub, sort=sort, time_filter=time_filter, limit=limit)


def search_reddit(
    query: str,
    sub: str | None = None,
    sort: Sort = "relevance",
    time_filter: TimeFilter = "all",
    limit: int = 50,
    save: bool = True,
) -> list[dict]:
    from . import _reddit_tiers as rt

    mode = load_config().mode
    fetch_id = log_fetch_start(
        "search",
        {"query": query, "sub": sub, "sort": sort, "time_filter": time_filter, "limit": limit, "mode": mode},
    )
    try:
        tiers = []
        if mode == "auth":
            tiers.append(("praw", lambda: _search_auth(query, sub, sort, time_filter, limit)))
        tiers.append(("cookie", lambda: rt.cookie_search(query, sub, sort, time_filter, limit)))
        tiers.append(("rss", lambda: _search_public(query, sub, sort, time_filter, limit)))
        rows, tier = rt.run_cascade(tiers)
        if save:
            upsert_posts(rows)
        log_fetch_end(fetch_id, rows=len(rows))
        return rows
    except Exception as e:
        log_fetch_end(fetch_id, rows=0, error=str(e))
        raise
