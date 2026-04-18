"""SQLite schema + upsert helpers via sqlite-utils.

Tables mirror Reddit's model; every row has `fetched_at` so we can
track freshness without losing history.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

from sqlite_utils import Database

from .config import load_config


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@lru_cache(maxsize=1)
def get_db() -> Database:
    cfg = load_config()
    db = Database(cfg.db_path)
    init_schema(db)
    return db


def init_schema(db: Database) -> None:
    """Idempotent schema creation."""
    if "posts" not in db.table_names():
        db["posts"].create(
            {
                "id": str,
                "sub": str,
                "author": str,
                "title": str,
                "selftext": str,
                "url": str,
                "score": int,
                "upvote_ratio": float,
                "num_comments": int,
                "created_utc": float,
                "is_self": int,
                "over_18": int,
                "flair": str,
                "permalink": str,
                "fetched_at": str,
            },
            pk="id",
        )
        db["posts"].create_index(["sub"])
        db["posts"].create_index(["created_utc"])
        db["posts"].create_index(["author"])

    if "comments" not in db.table_names():
        db["comments"].create(
            {
                "id": str,
                "post_id": str,
                "parent_id": str,
                "author": str,
                "body": str,
                "score": int,
                "created_utc": float,
                "depth": int,
                "fetched_at": str,
            },
            pk="id",
        )
        db["comments"].create_index(["post_id"])
        db["comments"].create_index(["author"])

    if "users" not in db.table_names():
        db["users"].create(
            {
                "name": str,
                "link_karma": int,
                "comment_karma": int,
                "created_utc": float,
                "is_mod": int,
                "fetched_at": str,
            },
            pk="name",
        )

    if "subreddits" not in db.table_names():
        db["subreddits"].create(
            {
                "name": str,
                "subscribers": int,
                "description": str,
                "fetched_at": str,
            },
            pk="name",
        )

    if "fetches" not in db.table_names():
        db["fetches"].create(
            {
                "id": int,
                "kind": str,
                "params_json": str,
                "started_at": str,
                "ended_at": str,
                "rows": int,
                "error": str,
            },
            pk="id",
        )

    if "streams" not in db.table_names():
        db["streams"].create(
            {
                "id": int,
                "name": str,
                "sub": str,
                "keywords": str,
                "started_at": str,
                "active": int,
            },
            pk="id",
        )
        db["stream_hits"].create(
            {
                "stream_id": int,
                "item_type": str,
                "item_id": str,
                "matched_at": str,
                "keywords_matched": str,
            },
            pk=("stream_id", "item_type", "item_id"),
        )


# ── Fetch audit log ──────────────────────────────────────────────────────────

def log_fetch_start(kind: str, params: dict[str, Any]) -> int:
    db = get_db()
    row = db["fetches"].insert(
        {
            "kind": kind,
            "params_json": json.dumps(params, default=str),
            "started_at": _utc_now(),
            "ended_at": None,
            "rows": 0,
            "error": None,
        }
    )
    return row.last_pk  # type: ignore[no-any-return]


def log_fetch_end(fetch_id: int, rows: int, error: str | None = None) -> None:
    db = get_db()
    db["fetches"].update(
        fetch_id, {"ended_at": _utc_now(), "rows": rows, "error": error}
    )


# ── Upserts ──────────────────────────────────────────────────────────────────

def upsert_posts(rows: Iterable[dict[str, Any]]) -> int:
    rows = list(rows)
    if not rows:
        return 0
    get_db()["posts"].upsert_all(rows, pk="id")
    return len(rows)


def upsert_comments(rows: Iterable[dict[str, Any]]) -> int:
    rows = list(rows)
    if not rows:
        return 0
    get_db()["comments"].upsert_all(rows, pk="id")
    return len(rows)


def upsert_users(rows: Iterable[dict[str, Any]]) -> int:
    rows = list(rows)
    if not rows:
        return 0
    get_db()["users"].upsert_all(rows, pk="name")
    return len(rows)


def upsert_subreddit(row: dict[str, Any]) -> None:
    get_db()["subreddits"].upsert(row, pk="name")


__all__ = [
    "get_db",
    "init_schema",
    "log_fetch_start",
    "log_fetch_end",
    "upsert_posts",
    "upsert_comments",
    "upsert_users",
    "upsert_subreddit",
]
