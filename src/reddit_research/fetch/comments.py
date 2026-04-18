"""Fetch a comment tree for a given post."""
from __future__ import annotations

from ..core.client import get_reddit
from ..core.db import log_fetch_end, log_fetch_start, upsert_comments, upsert_posts
from ._shape import comment_row, post_row


def fetch_comments(
    post_id: str,
    depth: int | None = None,
    limit: int | None = None,
    save: bool = True,
) -> list[dict]:
    """Fetch the comment tree. `depth=None` means full tree.

    Also persists the parent post (useful when fetching comments standalone).
    """
    fetch_id = log_fetch_start(
        "comments", {"post_id": post_id, "depth": depth, "limit": limit}
    )
    try:
        reddit = get_reddit()
        submission = reddit.submission(id=post_id)
        # Expand "more comments" nodes. limit=None expands all; cheap for small threads.
        submission.comments.replace_more(limit=limit)

        rows: list[dict] = []

        def _walk(cs, cur_depth: int) -> None:
            if depth is not None and cur_depth > depth:
                return
            for c in cs:
                rows.append(comment_row(c, post_id=post_id, depth=cur_depth))
                if getattr(c, "replies", None):
                    _walk(c.replies, cur_depth + 1)

        _walk(submission.comments, 0)

        if save:
            upsert_posts([post_row(submission)])
            upsert_comments(rows)
        log_fetch_end(fetch_id, rows=len(rows))
        return rows
    except Exception as e:
        log_fetch_end(fetch_id, rows=0, error=str(e))
        raise
