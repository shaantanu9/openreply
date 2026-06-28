"""Web reader — clean any URL to markdown via Jina Reader. Zero-config.

Jina Reader (`https://r.jina.ai/<url>`) fetches any page and returns clean,
LLM-ready markdown — no key, no scraping logic. We treat the query as a URL and
emit ONE post row (title = first markdown H1 or the URL; selftext = first 2000
chars). Used both as a standalone source and as the backend for the LinkedIn
public-URL reader.

Ported from agent-reach `channels/web.py` (MIT). Never raises — returns [].
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone

from ._http import polite_get

_JINA = "https://r.jina.ai/"
_H1_RE = re.compile(r"^#\s+(.+)$", re.M)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _jina_read(url: str, cookie: str | None = None) -> str | None:
    """Return clean markdown for *url* via Jina Reader, or None on failure.
    `cookie` (a 'k=v; k2=v2' string) is forwarded to the target site via Jina's
    `x-set-cookie` header — used to read login-gated pages (e.g. LinkedIn li_at)."""
    url = (url or "").strip()
    if not url:
        return None
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    headers = {"Accept": "text/plain"}
    if cookie:
        headers["x-set-cookie"] = cookie
    try:
        r = polite_get(f"{_JINA}{url}", headers=headers)
        r.raise_for_status()
        return r.text
    except Exception:
        return None


def _stable_id(ident: str) -> str:
    return hashlib.sha256(ident.encode("utf-8")).hexdigest()[:16]


def _row(url: str, text: str, source_type: str = "web") -> dict:
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    m = _H1_RE.search(text)
    title = (m.group(1) if m else url)[:300]
    return {
        "id": f"{source_type}_{_stable_id(url)}",
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


def fetch_web_reader(query: str, limit: int = 1, cookie: str | None = None, **_) -> list[dict]:
    """Read the URL in *query* via Jina Reader → one post row. Never raises.

    `cookie` is a 'k=v; k2=v2' string forwarded via Jina's `x-set-cookie`
    header for login-gated pages (e.g. LinkedIn `li_at`). `limit` is accepted
    for API compatibility but only one row is returned per URL.
    """
    url = (query or "").strip()
    if not url:
        return []
    text = _jina_read(url, cookie=cookie)
    if text is None:
        return []
    return [_row(url, text, "web")]
