"""Fetch a user's posts + comments."""
from __future__ import annotations

from typing import Literal

from ..core.client import get_reddit
from ..core.db import (
    log_fetch_end,
    log_fetch_start,
    upsert_comments,
    upsert_posts,
    upsert_users,
)
from ._shape import comment_row, post_row, user_row

Kind = Literal["posts", "comments", "both"]


def fetch_user(
    name: str,
    kind: Kind = "both",
    limit: int = 100,
    save: bool = True,
) -> dict:
    """Return {user, posts, comments}. Each item is a plain dict row."""
    fetch_id = log_fetch_start("user", {"name": name, "kind": kind, "limit": limit})
    try:
        reddit = get_reddit()
        redditor = reddit.redditor(name)
        out: dict = {"user": user_row(redditor), "posts": [], "comments": []}

        if kind in ("posts", "both"):
            out["posts"] = [post_row(p) for p in redditor.submissions.new(limit=limit)]
        if kind in ("comments", "both"):
            out["comments"] = [
                comment_row(c, post_id=c.submission.id, depth=0)
                for c in redditor.comments.new(limit=limit)
            ]

        if save:
            upsert_users([out["user"]])
            upsert_posts(out["posts"])
            upsert_comments(out["comments"])

        log_fetch_end(fetch_id, rows=len(out["posts"]) + len(out["comments"]))
        return out
    except Exception as e:
        log_fetch_end(fetch_id, rows=0, error=str(e))
        raise
