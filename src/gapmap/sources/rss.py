"""Generic RSS/Atom feed adapter.

Fetches any feed via `feedparser`, filters entries by topic keyword match
(case-insensitive substring in title + summary), and returns the common
`posts` row shape used by every other source.

No API keys. No rate limits beyond per-host politeness (enforced in the
collect adapter by looping one feed at a time with a short sleep).
"""
from __future__ import annotations

import calendar
import hashlib
import re
from datetime import datetime, timezone
from typing import Any

from ._http import DEFAULT_HEADERS, DEFAULT_TIMEOUT

import httpx


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _require_feedparser():
    try:
        import feedparser  # type: ignore
    except ImportError as e:  # pragma: no cover - sources extra is always installed in the sidecar
        raise RuntimeError("Install sources extra: pip install -e '.[sources]'") from e
    return feedparser


def _stable_id(feed_url: str, entry_id: str) -> str:
    """Deterministic, URL-safe id for posts dedup. hashlib avoids relying on
    Python's hash() which is PYTHONHASHSEED-salted between runs.
    """
    h = hashlib.sha1(f"{feed_url}::{entry_id}".encode("utf-8")).hexdigest()[:16]
    return f"rss_{h}"


def _entry_to_row(entry, feed_url: str, publication: str, category: str) -> dict[str, Any]:
    rid = entry.get("id") or entry.get("link") or entry.get("title") or ""
    ts = 0.0
    for key in ("published_parsed", "updated_parsed"):
        val = getattr(entry, key, None) or entry.get(key)
        if val:
            try:
                ts = float(calendar.timegm(val))
                break
            except (TypeError, ValueError):
                pass
    # feedparser exposes summary in multiple shapes; prefer the cleanest.
    summary = (
        entry.get("summary")
        or (entry.get("content", [{}])[0].get("value") if entry.get("content") else "")
        or ""
    )
    return {
        "id": _stable_id(feed_url, rid),
        "sub": f"rss:{category}",
        "source_type": "rss",
        "author": publication or "rss",
        "title": (entry.get("title") or "")[:300],
        "selftext": summary[:2000],
        "url": entry.get("link") or feed_url,
        "score": 0,
        "upvote_ratio": None,
        "num_comments": 0,
        "created_utc": ts,
        "is_self": 0,
        "over_18": 0,
        "flair": publication[:100] if publication else None,
        # IMPORTANT: leave permalink None for non-Reddit sources. The
        # frontend prepends https://www.reddit.com to permalink when
        # set, so storing an arbitrary article URL here produced
        # broken cross-domain links. The article URL lives in `url`.
        "permalink": None,
        "fetched_at": _now_iso(),
    }


def _matches_query(row: dict[str, Any], query: str | list[str] | None) -> bool:
    """RSS relevance matcher.

    Old behavior required the full query phrase as a literal substring in
    title/summary, which over-filtered feeds for normal topics
    ("ai product analytics", "calorie tracking app", etc.). We now accept:
      - full-phrase hit, OR
      - token overlap hit:
          * single-token query  -> at least 1 token match
          * multi-token query   -> at least 2 token matches
    """
    if query is None:
        return True
    queries = [query] if isinstance(query, str) else list(query or [])
    queries = [str(q).strip().lower() for q in queries if str(q).strip()]
    if not queries:
        return True
    hay = f"{row.get('title') or ''} {row.get('selftext') or ''}".lower()
    for q in queries:
        if q in hay:
            return True
        tokens = [t for t in re.findall(r"[a-z0-9]+", q) if len(t) >= 3]
        if not tokens:
            continue
        hits = sum(1 for t in set(tokens) if t in hay)
        need = 1 if len(set(tokens)) == 1 else 2
        if hits >= need:
            return True
    return False


def fetch_rss(
    feed_url: str,
    *,
    query: str | list[str] | None = None,
    publication: str = "",
    category: str = "rss",
    limit: int = 30,
) -> list[dict]:
    """Fetch one RSS feed. If `query` is given, filter entries by
    case-insensitive substring match in title OR summary.

    Returns [] on any network/parse error — adapter-level logging handles
    the "one feed was flaky" case without killing the whole collect.
    """
    feedparser = _require_feedparser()
    try:
        r = httpx.get(
            feed_url,
            headers=DEFAULT_HEADERS,
            # RSS endpoints vary wildly in latency; keep per-feed timeout short
            # so one dead publication doesn't stall the entire category bundle.
            timeout=min(DEFAULT_TIMEOUT, 10.0),
            follow_redirects=True,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []

    feed = feedparser.parse(r.text)
    entries = feed.entries or []
    if not entries:
        return []

    rows = [_entry_to_row(e, feed_url, publication, category) for e in entries]
    if query:
        rows = [row for row in rows if _matches_query(row, query)]
    return rows[:limit]
