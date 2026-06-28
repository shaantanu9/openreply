"""Semantic Scholar API — free, no key needed (rate-limited).

https://api.semanticscholar.org/graph/v1/paper/search
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import httpx

_BASE = "https://api.semanticscholar.org/graph/v1"
_FIELDS = "title,abstract,year,authors,citationCount,influentialCitationCount,url,venue"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(p: dict[str, Any]) -> dict[str, Any]:
    authors = ", ".join((a.get("name") or "") for a in (p.get("authors") or [])[:3])
    year = p.get("year") or 0
    # Approximate created_utc from year
    try:
        ts = datetime(int(year), 1, 1, tzinfo=timezone.utc).timestamp() if year else 0
    except ValueError:
        ts = 0
    return {
        "id": f"scholar_{p.get('paperId')}",
        "sub": "scholar",
        "source_type": "scholar",
        "author": authors or "[unknown]",
        "title": p.get("title") or "",
        "selftext": (p.get("abstract") or "")[:2000],
        "url": p.get("url") or "",
        "score": int(p.get("citationCount") or 0),
        "upvote_ratio": None,
        "num_comments": int(p.get("influentialCitationCount") or 0),
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": p.get("venue") or None,
        "permalink": p.get("url"),
        "fetched_at": _now_iso(),
    }


def fetch_scholar(query: str, limit: int = 30, year_from: int | None = None) -> list[dict]:
    """Search Semantic Scholar for papers matching a query.

    Semantic Scholar's free tier is rate-limited to ~1 req/s; exceeding it
    gets a 429 with a Retry-After header. polite_get handles the first 429,
    and between successful pages we sleep 1.1 s (just above the floor).
    If the user has a `SEMANTIC_SCHOLAR_API_KEY` the request can go up to
    100 req/s, so we include it when set (otherwise omitted cleanly).
    """
    from ._http import polite_get

    import os as _os
    api_key = _os.getenv("SEMANTIC_SCHOLAR_API_KEY") or ""
    extra_headers = {"x-api-key": api_key} if api_key else {}

    collected: list[dict] = []
    offset = 0
    while len(collected) < limit:
        params: dict[str, Any] = {
            "query": query,
            "limit": min(100, limit - len(collected)),
            "offset": offset,
            "fields": _FIELDS,
        }
        if year_from:
            params["year"] = f"{year_from}-"
        try:
            r = polite_get(
                f"{_BASE}/paper/search",
                params=params,
                headers=extra_headers,
                timeout=30,
            )
            if r.status_code == 429:
                # polite_get already retried once; give up this page cleanly.
                break
            r.raise_for_status()
        except httpx.HTTPError:
            break
        data = r.json() or {}
        papers = data.get("data") or []
        if not papers:
            break
        collected.extend(_row(p) for p in papers)
        offset += len(papers)
        if offset >= (data.get("total") or 0):
            break
        # Respect the 1 req/s free-tier floor with a 100 ms safety margin.
        time.sleep(0.1 if api_key else 1.1)
    return collected[:limit]
