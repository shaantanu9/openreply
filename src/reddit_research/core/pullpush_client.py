"""Pullpush.io client — Pushshift successor, historical Reddit archive.

Pullpush stopped ingesting new data around **May 19, 2025**. It still serves
everything up to that cutoff — 13+ years of posts + comments.

CAVEAT (tested Apr 2026): pullpush's full-text `q` search parameter times
out on most queries. Subreddit + time-range queries (no `q`) are fast and
reliable. Strategy: pull by sub+date into SQLite, then do keyword matching
locally via SQL LIKE — zero-cost re-queries vs a flaky remote search.

Shape of returned rows mirrors `core.public_client._post_row` /
`_comment_row` so they slot into the existing SQLite tables unchanged.
"""
from __future__ import annotations

import random
import time
from datetime import datetime, timezone
from typing import Any, Iterator, Literal

import httpx

_BASE = "https://api.pullpush.io/reddit"
_TIMEOUT = 30.0
_CUTOFF_UTC = 1747699200  # 2025-05-20 00:00 UTC — pullpush stopped ingesting around here
_PAGE_SIZE = 100  # pullpush honors up to 500 but 100 is friendlier and reliable

Kind = Literal["submission", "comment"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _headers() -> dict[str, str]:
    # Pullpush isn't as fingerprint-aggressive as Reddit but a descriptive UA helps
    return {
        "User-Agent": "reddit-myind/0.1 (pullpush client)",
        "Accept": "application/json",
    }


def _get(path: str, params: dict[str, Any], timeout: float | None = None) -> list[dict[str, Any]]:
    """GET with backoff. Returns the `data` list, [] on hard failure (no raise).

    We never raise — pullpush is best-effort supplementary data; hard failures
    shouldn't crash a research run. Callers get an empty page and move on.
    """
    url = f"{_BASE}{path}"
    # Queries with `q` (full-text) are slow → give them extra time
    t = timeout or (_TIMEOUT * 2 if params.get("q") else _TIMEOUT)
    for attempt in range(3):
        try:
            r = httpx.get(url, params=params, headers=_headers(), timeout=t)
            if r.status_code == 429:
                time.sleep(min(float(r.headers.get("Retry-After", "2")), 30))
                continue
            if r.status_code >= 500:
                time.sleep(2.0 * (attempt + 1))
                continue
            r.raise_for_status()
            return r.json().get("data") or []
        except (httpx.TimeoutException, httpx.HTTPError):
            time.sleep(1.5**attempt + random.uniform(0, 0.5))
    return []


# ── shape converters — output matches reddit_research.fetch._shape ──────────

def _submission_row(d: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": d.get("id"),
        "sub": (d.get("subreddit") or "").lower() or None,
        "author": d.get("author") or "[deleted]",
        "title": d.get("title"),
        "selftext": d.get("selftext") or "",
        "url": d.get("url"),
        "score": d.get("score"),
        "upvote_ratio": d.get("upvote_ratio"),
        "num_comments": d.get("num_comments"),
        "created_utc": d.get("created_utc"),
        "is_self": int(bool(d.get("is_self"))),
        "over_18": int(bool(d.get("over_18"))),
        "flair": d.get("link_flair_text"),
        "permalink": f"https://www.reddit.com{d['permalink']}"
        if d.get("permalink")
        else None,
        "fetched_at": _now_iso(),
    }


def _comment_row(d: dict[str, Any]) -> dict[str, Any]:
    # pullpush stores `link_id` as `t3_<id>`; strip to match our post_id convention
    link_id = d.get("link_id") or ""
    if link_id.startswith("t3_"):
        link_id = link_id[3:]
    return {
        "id": d.get("id"),
        "post_id": link_id,
        "parent_id": d.get("parent_id"),
        "author": d.get("author") or "[deleted]",
        "body": d.get("body") or "",
        "score": d.get("score"),
        "created_utc": d.get("created_utc"),
        "depth": 0,  # pullpush doesn't give depth; post-processing needed if required
        "fetched_at": _now_iso(),
    }


# ── paginated search — the workhorse ────────────────────────────────────────

def pullpush_search(
    kind: Kind,
    subreddit: str | None = None,
    query: str | None = None,
    after: int | None = None,
    before: int | None = None,
    limit: int = 500,
    page_size: int = _PAGE_SIZE,
    sleep: float = 0.8,
) -> list[dict[str, Any]]:
    """Fetch up to `limit` items, paginating by created_utc.

    Args:
      kind: 'submission' or 'comment'.
      subreddit: restrict to one sub (case-insensitive).
      query: keyword filter (pullpush supports quoted phrases).
      after: unix ts, only items after this.
      before: unix ts, only items before this. Automatically clamped to pullpush cutoff.
      limit: max total items.
      page_size: per-page size (≤500).

    Returns: list of rows in our canonical shape.
    """
    if kind not in ("submission", "comment"):
        raise ValueError(f"kind must be 'submission' or 'comment', got {kind!r}")

    # Clamp before to pullpush's known cutoff so we don't burn requests for no data
    if before is None or before > _CUTOFF_UTC:
        before = _CUTOFF_UTC

    path = f"/{kind}/search/"
    convert = _submission_row if kind == "submission" else _comment_row

    collected: list[dict[str, Any]] = []
    cursor_before = before

    while len(collected) < limit:
        page_want = min(page_size, limit - len(collected))
        params: dict[str, Any] = {"size": page_want, "sort": "desc", "sort_type": "created_utc"}
        if subreddit:
            params["subreddit"] = subreddit
        if query:
            params["q"] = query
        if after:
            params["after"] = after
        params["before"] = cursor_before

        batch = _get(path, params)
        if not batch:
            break

        for d in batch:
            row = convert(d)
            if row.get("id"):
                collected.append(row)

        oldest = min(
            (d.get("created_utc") or cursor_before for d in batch),
            default=cursor_before,
        )
        if oldest >= cursor_before or (after and oldest <= after):
            # No forward progress → exit to avoid infinite loop
            break
        cursor_before = int(oldest) - 1

        time.sleep(sleep)

    return collected[:limit]


def pullpush_iter_pages(
    kind: Kind,
    subreddit: str | None = None,
    query: str | None = None,
    after: int | None = None,
    before: int | None = None,
    page_size: int = _PAGE_SIZE,
    sleep: float = 0.8,
) -> Iterator[list[dict[str, Any]]]:
    """Generator form — yield one page at a time so callers can upsert incrementally."""
    if before is None or before > _CUTOFF_UTC:
        before = _CUTOFF_UTC
    path = f"/{kind}/search/"
    convert = _submission_row if kind == "submission" else _comment_row
    cursor_before = before

    while True:
        params: dict[str, Any] = {
            "size": page_size,
            "sort": "desc",
            "sort_type": "created_utc",
            "before": cursor_before,
        }
        if subreddit:
            params["subreddit"] = subreddit
        if query:
            params["q"] = query
        if after:
            params["after"] = after
        batch = _get(path, params)
        if not batch:
            return
        yield [convert(d) for d in batch if d.get("id")]
        oldest = min(
            (d.get("created_utc") or cursor_before for d in batch),
            default=cursor_before,
        )
        if oldest >= cursor_before or (after and oldest <= after):
            return
        cursor_before = int(oldest) - 1
        time.sleep(sleep)


CUTOFF_UTC = _CUTOFF_UTC  # re-export for use by other modules
