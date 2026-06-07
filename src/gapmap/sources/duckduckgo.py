"""DuckDuckGo — general web + news search, no API key.

Pure-httpx against the DDG HTML endpoint + BeautifulSoup (both already
base deps, so no new dependency). Fills a real hole: Gap Map has no
general web search — useful as a context/seed fallback and for the
forecast engine's seed documents.

DDG HTML is best-effort/anti-bot-prone; on any failure we return []
rather than raise.
"""
from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import httpx

from ._http import DEFAULT_HEADERS
from ._extra_common import text_row

_HTML = "https://html.duckduckgo.com/html/"
_LITE = "https://lite.duckduckgo.com/lite/"


def _unwrap(href: str) -> str:
    # DDG wraps results as /l/?uddg=<encoded-target>.
    if href.startswith("//"):
        href = "https:" + href
    try:
        p = urlparse(href)
        if "duckduckgo.com" in p.netloc and p.path.startswith("/l/"):
            q = parse_qs(p.query)
            if "uddg" in q:
                return q["uddg"][0]
    except Exception:
        pass
    return href


def fetch_duckduckgo(query: str, limit: int = 25) -> list[dict]:
    """Web search. Returns common posts rows. Never raises."""
    try:
        from bs4 import BeautifulSoup  # base dep
    except ImportError:
        return []
    rows: list[dict] = []
    for endpoint in (_HTML, _LITE):
        try:
            r = httpx.post(
                endpoint,
                data={"q": query, "kl": "us-en"},
                headers=DEFAULT_HEADERS,
                timeout=20.0,
                follow_redirects=True,
            )
            r.raise_for_status()
        except httpx.HTTPError:
            continue
        soup = BeautifulSoup(r.text, "html.parser")
        anchors = soup.select("a.result__a") or soup.select("a.result-link")
        for a in anchors[:limit]:
            title = a.get_text(" ", strip=True)
            url = _unwrap(a.get("href", ""))
            if not title or not url:
                continue
            # snippet: nearest result__snippet if present
            snippet = ""
            parent = a.find_parent(class_="result") or a.find_parent("tr")
            if parent:
                sn = parent.select_one(".result__snippet")
                if sn:
                    snippet = sn.get_text(" ", strip=True)
            host = urlparse(url).netloc
            rows.append(
                text_row(
                    "duckduckgo",
                    ident=url,
                    title=title,
                    body=snippet or title,
                    url=url,
                    sub=(host or "duckduckgo")[:60],
                    author=host,
                )
            )
        if rows:
            break
    return rows[:limit]
