"""OpenAlex — fully open scholarly data, 200M+ works. Free, no key needed.

https://docs.openalex.org/
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

_BASE = "https://api.openalex.org"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(w: dict[str, Any]) -> dict[str, Any]:
    title = (w.get("title") or w.get("display_name") or "")[:300]
    abstract_idx = w.get("abstract_inverted_index") or {}
    abstract = _reconstruct_abstract(abstract_idx)[:2000]
    year = w.get("publication_year") or 0
    try:
        ts = datetime(int(year), 1, 1, tzinfo=timezone.utc).timestamp() if year else 0
    except ValueError:
        ts = 0
    authors = ", ".join(
        (a.get("author") or {}).get("display_name", "")
        for a in (w.get("authorships") or [])[:3]
    )
    venue = ((w.get("primary_location") or {}).get("source") or {}).get("display_name")
    return {
        "id": f"openalex_{w.get('id', '').rsplit('/', 1)[-1]}",
        "sub": "openalex",
        "source_type": "openalex",
        "author": authors or "[unknown]",
        "title": title,
        "selftext": abstract,
        "url": w.get("id") or "",
        "score": int(w.get("cited_by_count") or 0),
        "upvote_ratio": None,
        "num_comments": 0,
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": venue,
        "permalink": w.get("id"),
        "fetched_at": _now_iso(),
    }


def _reconstruct_abstract(inverted: dict[str, list[int]]) -> str:
    """OpenAlex returns abstract as {word: [positions]} — reconstruct."""
    if not inverted:
        return ""
    positions: list[tuple[int, str]] = []
    for word, ps in inverted.items():
        for p in ps:
            positions.append((p, word))
    positions.sort()
    return " ".join(w for _, w in positions)


def fetch_openalex(query: str, limit: int = 30, year_from: int | None = None) -> list[dict]:
    collected: list[dict] = []
    cursor = "*"
    while len(collected) < limit:
        params: dict[str, Any] = {
            "search": query,
            "per_page": min(200, limit - len(collected)),
            "cursor": cursor,
        }
        if year_from:
            params["filter"] = f"publication_year:>={year_from}"
        try:
            r = httpx.get(f"{_BASE}/works", params=params, timeout=20)
            r.raise_for_status()
        except httpx.HTTPError:
            break
        data = r.json() or {}
        works = data.get("results") or []
        if not works:
            break
        collected.extend(_row(w) for w in works)
        cursor = (data.get("meta") or {}).get("next_cursor")
        if not cursor:
            break
    return collected[:limit]
