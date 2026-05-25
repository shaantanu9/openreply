"""arXiv pre-prints via the free Atom API. No key. Docs: https://info.arxiv.org/help/api/index.html"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx

_BASE = "https://export.arxiv.org/api/query"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_atom(xml: str) -> list[dict]:
    entries = re.findall(r"<entry>(.*?)</entry>", xml, re.DOTALL)
    rows: list[dict] = []
    for e in entries:
        def g(tag):
            m = re.search(rf"<{tag}>(.*?)</{tag}>", e, re.DOTALL)
            return (m.group(1).strip() if m else "").strip()
        aid = g("id").rsplit("/", 1)[-1]
        title = re.sub(r"\s+", " ", g("title"))
        summary = re.sub(r"\s+", " ", g("summary"))
        published = g("published")
        try:
            ts = datetime.fromisoformat(published.replace("Z", "+00:00")).timestamp()
        except (ValueError, AttributeError):
            ts = 0.0
        authors = re.findall(r"<author>\s*<name>(.*?)</name>", e)
        link_pdf = re.search(r'<link[^>]+title="pdf"[^>]+href="([^"]+)"', e)
        rows.append(
            {
                "id": f"arxiv_{aid}",
                "sub": "arxiv",
                "source_type": "arxiv",
                "author": ", ".join(authors[:3]) or "[unknown]",
                "title": title,
                "selftext": summary[:2000],
                "url": link_pdf.group(1) if link_pdf else f"https://arxiv.org/abs/{aid}",
                "score": 0,
                "upvote_ratio": None,
                "num_comments": 0,
                "created_utc": float(ts),
                "is_self": 1,
                "over_18": 0,
                "flair": None,
                "permalink": f"https://arxiv.org/abs/{aid}",
                "fetched_at": _now_iso(),
            }
        )
    return rows


def fetch_arxiv(
    query: str,
    limit: int = 30,
    sort_by: str = "relevance",  # relevance | submittedDate | lastUpdatedDate
) -> list[dict]:
    from ._http import DEFAULT_HEADERS
    try:
        r = httpx.get(
            _BASE,
            params={
                "search_query": f"all:{query}",
                "max_results": min(100, limit),
                "sortBy": sort_by,
                "sortOrder": "descending",
            },
            timeout=20,
            follow_redirects=True,
            headers=DEFAULT_HEADERS,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    time.sleep(0.3)
    return _parse_atom(r.text)[:limit]
