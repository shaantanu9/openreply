"""Fetch posts from a subreddit. Auto-selects PRAW (if authed) or public JSON."""
from __future__ import annotations

from typing import Literal

from ..core.config import load_config
from ..core.db import log_fetch_end, log_fetch_start, upsert_posts

Sort = Literal["hot", "new", "top", "rising", "controversial"]
TimeFilter = Literal["hour", "day", "week", "month", "year", "all"]


def _fetch_auth(sub: str, sort: str, limit: int, time_filter: str) -> list[dict]:
    from ..core.client import get_reddit
    from ._shape import post_row

    sr = get_reddit().subreddit(sub)
    listing = {
        "hot": lambda: sr.hot(limit=limit),
        "new": lambda: sr.new(limit=limit),
        "rising": lambda: sr.rising(limit=limit),
        "top": lambda: sr.top(time_filter=time_filter, limit=limit),
        "controversial": lambda: sr.controversial(time_filter=time_filter, limit=limit),
    }[sort]()
    return [post_row(p) for p in listing]


def _fetch_public(sub: str, sort: str, limit: int, time_filter: str) -> list[dict]:
    from ..core.public_client import public_get_posts

    if sort == "rising":
        # Public endpoint supports /rising.json too
        pass
    return public_get_posts(sub=sub, sort=sort, limit=limit, time_filter=time_filter)


def fetch_posts(
    sub: str,
    sort: Sort = "hot",
    limit: int = 50,
    time_filter: TimeFilter = "day",
    save: bool = True,
) -> list[dict]:
    """Fetch posts from r/<sub>. Returns list of plain dicts; persists if save=True."""
    mode = load_config().mode
    fetch_id = log_fetch_start(
        "posts",
        {"sub": sub, "sort": sort, "limit": limit, "time_filter": time_filter, "mode": mode},
    )
    try:
        rows = (
            _fetch_auth(sub, sort, limit, time_filter)
            if mode == "auth"
            else _fetch_public(sub, sort, limit, time_filter)
        )
        if save:
            upsert_posts(rows)
        log_fetch_end(fetch_id, rows=len(rows))
        return rows
    except Exception as e:
        log_fetch_end(fetch_id, rows=0, error=str(e))
        raise
