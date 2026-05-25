"""Wikipedia pageviews + summary. Free, no key.

- Pageviews: https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/...
- Summary:  https://en.wikipedia.org/api/rest_v1/page/summary/<title>
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx


def fetch_wikipedia_summary(topic: str, lang: str = "en") -> dict:
    safe_title = quote(topic.replace(" ", "_"), safe="")
    try:
        r = httpx.get(
            f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{safe_title}",
            timeout=15,
            follow_redirects=True,
            headers={"User-Agent": "gapmap/0.1"},
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return {"topic": topic, "error": "fetch_failed"}
    data = r.json() or {}
    return {
        "topic": topic,
        "title": data.get("title"),
        "description": data.get("description"),
        "extract": data.get("extract"),
        "url": (data.get("content_urls") or {}).get("desktop", {}).get("page"),
    }


def fetch_wikipedia_pageviews(
    topic: str,
    days: int = 365,
    lang: str = "en",
) -> dict:
    """Get daily pageviews for a topic over a window ending yesterday."""
    end = datetime.now(timezone.utc) - timedelta(days=1)
    start = end - timedelta(days=days)
    title = quote(topic.replace(" ", "_"), safe="")
    url = (
        f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
        f"{lang}.wikipedia/all-access/all-agents/{title}/daily/"
        f"{start.strftime('%Y%m%d')}/{end.strftime('%Y%m%d')}"
    )
    try:
        r = httpx.get(url, headers={"User-Agent": "gapmap/0.1"}, timeout=20)
        r.raise_for_status()
    except httpx.HTTPError:
        return {"topic": topic, "error": "fetch_failed"}
    items = (r.json() or {}).get("items") or []
    return {
        "topic": topic,
        "lang": lang,
        "daily": [
            (i.get("timestamp", "")[:8], int(i.get("views") or 0))
            for i in items
        ],
        "total": sum(int(i.get("views") or 0) for i in items),
    }
