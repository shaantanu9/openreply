"""PyPI package search + pypistats.org download stats. Free, no key.

- Search: https://pypi.org/simple/ is HTML; use PyPI JSON via libraries-io style
- Downloads: https://pypistats.org/api/packages/<pkg>/recent
- Daily: https://pypistats.org/api/packages/<pkg>/overall
"""
from __future__ import annotations

import httpx


def fetch_pypi_downloads(package: str) -> dict:
    """Get recent download counts (last-day, last-week, last-month)."""
    try:
        r = httpx.get(f"https://pypistats.org/api/packages/{package}/recent", timeout=15)
        r.raise_for_status()
    except httpx.HTTPError:
        return {"package": package, "error": "fetch_failed"}
    data = (r.json() or {}).get("data") or {}
    return {
        "package": package,
        "last_day": data.get("last_day"),
        "last_week": data.get("last_week"),
        "last_month": data.get("last_month"),
    }


def search_pypi_packages(query: str, limit: int = 20) -> list[dict]:
    """Search PyPI via the free XML-RPC-ish /search/ endpoint."""
    # PyPI's official search endpoint was deprecated; we use the simple API
    # via a third-party index. Fallback: use pypi.org JSON for known names.
    try:
        r = httpx.get(
            "https://pypi.org/search/",
            params={"q": query},
            timeout=15,
            follow_redirects=True,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    # PyPI returns HTML — parse minimally for package names
    import re

    names = re.findall(r'class="package-snippet__name">([^<]+)</span>', r.text)[:limit]
    return [{"name": n, "url": f"https://pypi.org/project/{n}/"} for n in names]
