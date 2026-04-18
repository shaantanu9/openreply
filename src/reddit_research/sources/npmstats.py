"""npm download stats + package search. Free, keyless.

- Search: https://registry.npmjs.com/-/v1/search?text=X
- Downloads: https://api.npmjs.org/downloads/range/<range>/<pkg>
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def search_npm_packages(query: str, limit: int = 20) -> list[dict]:
    try:
        r = httpx.get(
            "https://registry.npmjs.com/-/v1/search",
            params={"text": query, "size": min(250, limit)},
            timeout=20,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    objs = (r.json() or {}).get("objects") or []
    out = []
    for o in objs[:limit]:
        pkg = o.get("package") or {}
        out.append(
            {
                "name": pkg.get("name"),
                "version": pkg.get("version"),
                "description": pkg.get("description"),
                "keywords": pkg.get("keywords") or [],
                "author": (pkg.get("author") or {}).get("name") or (pkg.get("publisher") or {}).get("username"),
                "date": pkg.get("date"),
                "score": (o.get("score") or {}).get("final"),
                "url": (pkg.get("links") or {}).get("npm"),
            }
        )
    return out


def fetch_npm_downloads(package: str, range_: str = "last-year") -> dict:
    """Returns total downloads + daily time series for a package."""
    try:
        r = httpx.get(f"https://api.npmjs.org/downloads/range/{range_}/{package}", timeout=20)
        r.raise_for_status()
    except httpx.HTTPError:
        return {"package": package, "error": "fetch_failed"}
    data = r.json() or {}
    downloads = data.get("downloads") or []
    total = sum(d.get("downloads", 0) for d in downloads)
    return {
        "package": package,
        "range": range_,
        "total": total,
        "daily": [(d.get("day"), d.get("downloads")) for d in downloads],
    }
