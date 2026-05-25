"""Shared row-shaping helpers — turns PRAW objects into plain dicts for SQLite."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def post_row(p: Any) -> dict[str, Any]:
    return {
        "id": p.id,
        "sub": str(p.subreddit).lower() if p.subreddit else None,
        "source_type": "reddit",
        "author": str(p.author) if p.author else "[deleted]",
        "title": p.title,
        "selftext": getattr(p, "selftext", "") or "",
        "url": p.url,
        "score": p.score,
        "upvote_ratio": getattr(p, "upvote_ratio", None),
        "num_comments": p.num_comments,
        "created_utc": p.created_utc,
        "is_self": int(bool(p.is_self)),
        "over_18": int(bool(p.over_18)),
        "flair": p.link_flair_text,
        "permalink": f"https://reddit.com{p.permalink}" if p.permalink else None,
        "fetched_at": _now(),
    }


def comment_row(c: Any, post_id: str, depth: int = 0) -> dict[str, Any]:
    return {
        "id": c.id,
        "post_id": post_id,
        "parent_id": c.parent_id,
        "author": str(c.author) if c.author else "[deleted]",
        "body": c.body,
        "score": c.score,
        "created_utc": c.created_utc,
        "depth": depth,
        "fetched_at": _now(),
    }


def user_row(u: Any) -> dict[str, Any]:
    return {
        "name": u.name,
        "link_karma": getattr(u, "link_karma", None),
        "comment_karma": getattr(u, "comment_karma", None),
        "created_utc": getattr(u, "created_utc", None),
        "is_mod": int(bool(getattr(u, "is_mod", False))),
        "fetched_at": _now(),
    }
