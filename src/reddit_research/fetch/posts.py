"""Fetch posts from a subreddit (hot/new/top/rising/controversial)."""
from __future__ import annotations

from typing import Literal

from ..core.client import get_reddit
from ..core.db import log_fetch_end, log_fetch_start, upsert_posts
from ._shape import post_row

Sort = Literal["hot", "new", "top", "rising", "controversial"]
TimeFilter = Literal["hour", "day", "week", "month", "year", "all"]


def fetch_posts(
    sub: str,
    sort: Sort = "hot",
    limit: int = 50,
    time_filter: TimeFilter = "day",
    save: bool = True,
) -> list[dict]:
    """Fetch posts from r/<sub>. Returns list of plain dicts; persists if save=True."""
    fetch_id = log_fetch_start(
        "posts", {"sub": sub, "sort": sort, "limit": limit, "time_filter": time_filter}
    )
    try:
        reddit = get_reddit()
        sr = reddit.subreddit(sub)
        listing = {
            "hot": lambda: sr.hot(limit=limit),
            "new": lambda: sr.new(limit=limit),
            "rising": lambda: sr.rising(limit=limit),
            "top": lambda: sr.top(time_filter=time_filter, limit=limit),
            "controversial": lambda: sr.controversial(time_filter=time_filter, limit=limit),
        }[sort]()

        rows = [post_row(p) for p in listing]
        if save:
            upsert_posts(rows)
        log_fetch_end(fetch_id, rows=len(rows))
        return rows
    except Exception as e:
        log_fetch_end(fetch_id, rows=0, error=str(e))
        raise
