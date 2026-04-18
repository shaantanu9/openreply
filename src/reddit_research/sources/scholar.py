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
    """Search Semantic Scholar for papers matching a query."""
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
            r = httpx.get(f"{_BASE}/paper/search", params=params, timeout=30)
            if r.status_code == 429:
                time.sleep(2)
                continue
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
        time.sleep(0.5)
    return collected[:limit]
