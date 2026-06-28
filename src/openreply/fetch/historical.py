"""Historical fetch via pullpush (pre-May-2025 archive).

Thin wrapper over `core.pullpush_client.pullpush_search` that handles
the audit log and SQLite upserts. Rows land in the same `posts` /
`comments` tables as the live fetchers, so everything downstream
(query, export, gap extraction) treats them identically.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Literal

from ..core.db import (
    log_fetch_end,
    log_fetch_start,
    upsert_comments,
    upsert_posts,
)
from ..core.pullpush_client import CUTOFF_UTC, pullpush_search

Kind = Literal["submission", "comment"]


def _days_ago_utc(days: int) -> int:
    return int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())


def fetch_historical(
    sub: str,
    kind: Kind = "submission",
    days: int = 365,
    before: int | None = None,
    limit: int = 1000,
    page_size: int = 100,
    save: bool = True,
) -> list[dict]:
    """Pull historical posts or comments via pullpush.

    Args:
      sub: subreddit name (case-insensitive).
      kind: 'submission' or 'comment'.
      days: how far back from `before` (or the cutoff) to go.
      before: upper bound as unix ts. Defaults to pullpush's cutoff (May 2025).
      limit: max items.
      page_size: ≤500; 100 is a friendly default.
    """
    before = before or CUTOFF_UTC
    after = before - days * 86400

    fid = log_fetch_start(
        "historical",
        {
            "sub": sub, "kind": kind, "days": days,
            "before": before, "after": after, "limit": limit,
        },
    )
    try:
        rows = pullpush_search(
            kind=kind, subreddit=sub,
            before=before, after=after,
            limit=limit, page_size=page_size,
        )
        if save and rows:
            if kind == "submission":
                upsert_posts(rows)
            else:
                upsert_comments(rows)
        log_fetch_end(fid, rows=len(rows))
        return rows
    except Exception as e:  # pragma: no cover — pullpush_search already swallows most
        log_fetch_end(fid, rows=0, error=str(e))
        raise


def fetch_historical_window(
    sub: str,
    start_days_ago: int = 730,
    end_days_ago: int = 0,
    kind: Kind = "submission",
    limit: int = 5000,
    page_size: int = 200,
    save: bool = True,
    sleep_between_pages: float = 0.8,
) -> list[dict]:
    """Pull everything from a sub across a window (e.g. 2y ago → now/cutoff).

    Unlike `fetch_historical`, this always clamps `before` to the pullpush
    cutoff and walks backwards until we hit the oldest bound — good for
    building a large corpus for deep gap research.
    """
    end_ts = min(_days_ago_utc(end_days_ago), CUTOFF_UTC)
    start_ts = _days_ago_utc(start_days_ago)
    fid = log_fetch_start(
        "historical_window",
        {"sub": sub, "kind": kind, "start_ts": start_ts, "end_ts": end_ts, "limit": limit},
    )
    try:
        rows = pullpush_search(
            kind=kind, subreddit=sub,
            before=end_ts, after=start_ts,
            limit=limit, page_size=page_size, sleep=sleep_between_pages,
        )
        if save and rows:
            if kind == "submission":
                upsert_posts(rows)
            else:
                upsert_comments(rows)
        log_fetch_end(fid, rows=len(rows))
        return rows
    except Exception as e:
        log_fetch_end(fid, rows=0, error=str(e))
        raise
