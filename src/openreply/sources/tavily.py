"""Tavily — high-quality (LLM-grade) web search. Free key required.

Pure-httpx POST to the Tavily REST API. Set TAVILY_API_KEY (free tier
~1,000 searches/mo at https://tavily.com). No key → returns [] cleanly.
Better web context than DDG; primary use is forecast-engine seed docs.
"""
from __future__ import annotations

import os

import httpx

from ._extra_common import text_row

_API = "https://api.tavily.com/search"


def fetch_tavily(query: str, limit: int = 15, *, search_depth: str = "basic") -> list[dict]:
    """Web search via Tavily. Returns common posts rows. Never raises."""
    key = os.environ.get("TAVILY_API_KEY")
    if not key:
        return []
    payload = {
        "api_key": key,
        "query": query,
        "max_results": min(max(limit, 1), 20),
        "search_depth": search_depth,
        "include_answer": False,
    }
    try:
        r = httpx.post(_API, json=payload, timeout=25.0)
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError):
        return []
    rows: list[dict] = []
    for it in (data.get("results") or [])[:limit]:
        title = it.get("title") or ""
        url = it.get("url") or ""
        if not title or not url:
            continue
        from urllib.parse import urlparse

        host = urlparse(url).netloc
        rows.append(
            text_row(
                "tavily",
                ident=url,
                title=title,
                body=it.get("content") or title,
                url=url,
                sub=(host or "tavily")[:60],
                author=host,
                score=int(round(float(it.get("score") or 0.0) * 100)),
            )
        )
    return rows
