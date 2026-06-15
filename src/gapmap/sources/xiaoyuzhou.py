"""Xiaoyuzhou (小宇宙) podcast — episode metadata. Zero-config.

Xiaoyuzhou is a popular Chinese podcast app. Given an episode URL
(`xiaoyuzhoufm.com/episode/<id>`) we fetch the page and extract the title and
show-notes/description into ONE post row. Full audio transcription (the
agent-reach path via ffmpeg + Groq Whisper) is intentionally out of scope here —
that reuses Gap Map's existing transcribe module in a later effort.

Never raises — returns [].
"""
from __future__ import annotations

import html
import re
from datetime import datetime, timezone

from ._http import polite_get

_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_DESC_RE = re.compile(
    r'<meta[^>]+(?:name|property)=["\'](?:og:description|description)["\'][^>]*'
    r'content=["\'](.*?)["\']',
    re.I | re.S,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _clean(s: str) -> str:
    return html.unescape(re.sub(r"\s+", " ", (s or "").strip()))


def fetch_xiaoyuzhou(query: str, limit: int = 1, **_) -> list[dict]:
    """Read a Xiaoyuzhou episode URL → one post row of title + show notes."""
    url = (query or "").strip()
    if not url or "xiaoyuzhoufm.com" not in url:
        return []
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        r = polite_get(url)
        r.raise_for_status()
        page = r.text
    except Exception:
        return []
    tm = _TITLE_RE.search(page)
    dm = _DESC_RE.search(page)
    title = _clean(tm.group(1) if tm else url)[:300]
    desc = _clean(dm.group(1) if dm else "")[:2000]
    return [{
        "id": f"xiaoyuzhou_{hash(url) & 0xFFFFFFFF:x}",
        "sub": "xiaoyuzhou",
        "source_type": "xiaoyuzhou",
        "author": "",
        "title": title,
        "selftext": desc,
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
    }]
