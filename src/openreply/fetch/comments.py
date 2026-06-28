"""Fetch a comment tree for a given post. Public mode can't expand 'more' stubs."""
from __future__ import annotations

from ..core.config import load_config
from ..core.db import log_fetch_end, log_fetch_start, upsert_comments, upsert_posts


def _fetch_auth(post_id: str, depth: int | None, limit: int | None) -> tuple[dict, list[dict]]:
    from ..core.client import get_reddit
    from ._shape import comment_row, post_row

    submission = get_reddit().submission(id=post_id)
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
    return post_row(submission), rows


def _fetch_public(post_id: str, depth: int | None) -> tuple[dict | None, list[dict]]:
    from ..core.public_client import public_get_comments

    return public_get_comments(post_id=post_id, depth=depth)


def fetch_comments(
    post_id: str,
    depth: int | None = None,
    limit: int | None = None,
    save: bool = True,
) -> list[dict]:
    """Fetch the comment tree. `depth=None` means full tree.

    Also persists the parent post. `limit` only applies in auth mode
    (controls PRAW's `replace_more`).
    """
    mode = load_config().mode
    fetch_id = log_fetch_start(
        "comments",
        {"post_id": post_id, "depth": depth, "limit": limit, "mode": mode},
    )
    try:
        if mode == "auth":
            post, rows = _fetch_auth(post_id, depth, limit)
        else:
            post, rows = _fetch_public(post_id, depth)
        if save:
            if post:
                upsert_posts([post])
            upsert_comments(rows)
        log_fetch_end(fetch_id, rows=len(rows))
        return rows
    except Exception as e:
        log_fetch_end(fetch_id, rows=0, error=str(e))
        raise
