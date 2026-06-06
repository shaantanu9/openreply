"""DBLP — the computer-science bibliography (6M+ publications). Free, no key.

Metadata-only (no abstracts), but excellent for CS/engineering paper discovery
and venue/author signal. https://dblp.org/faq/13501473
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

_BASE = "https://dblp.org/search/publ/api"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _authors(info: dict[str, Any]) -> str:
    a = (info.get("authors") or {}).get("author")
    if isinstance(a, dict):
        a = [a]
    if isinstance(a, list):
        names = [(x.get("text") if isinstance(x, dict) else str(x)) for x in a]
        return (", ".join(n for n in names if n)[:300]) or "[unknown]"
    return "[unknown]"


def _row(hit: dict[str, Any]) -> dict[str, Any]:
    info = hit.get("info") or {}
    try:
        year = int(str(info.get("year") or "0")[:4])
    except (ValueError, TypeError):
        year = 0
    ts = datetime(year, 1, 1, tzinfo=timezone.utc).timestamp() if year else 0.0
    url = info.get("ee") or info.get("url") or ""
    if isinstance(url, list):
        url = url[0] if url else ""
    venue = info.get("venue")
    if isinstance(venue, list):
        venue = ", ".join(str(v) for v in venue)
    return {
        "id": f"dblp_{hit.get('@id') or info.get('key') or url}",
        "sub": "dblp",
        "source_type": "dblp",
        "author": _authors(info),
        "title": (info.get("title") or "")[:300],
        "selftext": "",  # DBLP is metadata-only (no abstract)
        "url": url,
        "score": 0,
        "upvote_ratio": None,
        "num_comments": 0,
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": venue,
        "permalink": None,
        "fetched_at": _now_iso(),
    }


def fetch_dblp(query: str, limit: int = 30) -> list[dict]:
    params: dict[str, Any] = {"q": query, "format": "json", "h": min(100, limit)}
    try:
        r = httpx.get(_BASE, params=params, timeout=20, headers={"User-Agent": "gapmap/1.0"})
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    data = r.json() or {}
    hits = ((data.get("result") or {}).get("hits") or {}).get("hit") or []
    if isinstance(hits, dict):
        hits = [hits]
    return [_row(h) for h in hits][:limit]
