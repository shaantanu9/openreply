"""Web reader — clean any URL to markdown via Jina Reader. Zero-config.

Jina Reader (`https://r.jina.ai/<url>`) fetches any page and returns clean,
LLM-ready markdown — no key, no scraping logic. We treat the query as a URL and
emit ONE post row (title = first markdown H1 or the URL; selftext = first 2000
chars). Used both as a standalone source and as the backend for the LinkedIn
public-URL reader.

Ported from agent-reach `channels/web.py` (MIT). Never raises — returns [].
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from ._http import polite_get

_JINA = "https://r.jina.ai/"
_H1_RE = re.compile(r"^#\s+(.+)$", re.M)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _jina_read(url: str) -> str | None:
    """Return clean markdown for *url* via Jina Reader, or None on failure."""
    url = (url or "").strip()
    if not url:
        return None
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        r = polite_get(f"{_JINA}{url}", headers={"Accept": "text/plain"})
        r.raise_for_status()
        return r.text
    except Exception:
        return None


def _row(url: str, text: str, source_type: str = "web") -> dict:
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    m = _H1_RE.search(text)
    title = (m.group(1) if m else url)[:300]
    return {
        "id": f"{source_type}_{hash(url) & 0xFFFFFFFF:x}",
        "sub": source_type,
        "source_type": source_type,
        "author": "",
        "title": title,
        "selftext": text[:2000],
        "url": url,
        "score": 0,
        "upvote_ratio": None,
        "num_comments": 0,
        "created_utc": 0.0,
        "is_self": 1,
        "over_18": 0,
        "flair": None,
        "permalink": None,
        "fetched_at": _now_iso(),
    }


def fetch_web_reader(query: str, limit: int = 1, **_) -> list[dict]:
    """Read the URL in *query* via Jina Reader → one post row. Never raises."""
    text = _jina_read(query)
    if text is None:
        return []
    return [_row(query.strip(), text, "web")]
