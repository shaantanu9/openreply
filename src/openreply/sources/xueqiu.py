"""Xueqiu (雪球) — status search. Cookie-warm, optional stored token.

Xueqiu is China's largest investor social network. The status-search endpoint
needs a `xq_a_token` cookie; the site hands one out anonymously when you GET the
homepage first, so we warm the jar on each call (near-zero-config). If the user
has connected Xueqiu in Reach Connections, the stored cookie is sent too for
better quota. Never raises — returns [].

Ported from agent-reach `channels/xueqiu.py` (MIT) into the posts-row contract.
"""
from __future__ import annotations

import html
import re
from datetime import datetime, timezone

import httpx

from ..core import credentials as _creds
from ._http import USER_AGENT

_HOME = "https://xueqiu.com"
_SEARCH = "https://xueqiu.com/query/v1/search/status.json"
_TIMEOUT = 15.0
_TAG_RE = re.compile(r"<[^>]+>")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _clean(s: str) -> str:
    return html.unescape(_TAG_RE.sub("", s or "")).strip()


def _search(query: str, limit: int) -> dict:
    """Warm the cookie jar on the homepage, then run the status search.
    Returns the parsed JSON dict. Raises on HTTP/network error."""
    headers = {"User-Agent": USER_AGENT, "Referer": _HOME + "/"}
    stored = _creds.cookie_header("xueqiu")
    if stored:
        headers["Cookie"] = stored
    with httpx.Client(timeout=_TIMEOUT, follow_redirects=True, headers=headers) as c:
        c.get(_HOME)  # sets xq_a_token in the jar
        r = c.get(_SEARCH, params={"count": int(limit), "comment": 0, "symbol": "",
                                   "hl": 0, "source": "user", "sort": "time",
                                   "page": 1, "q": query})
        r.raise_for_status()
        return r.json()


def _row(it: dict) -> dict:
    user = it.get("user") or {}
    target = it.get("target") or ""
    url = (_HOME + target) if target.startswith("/") else (target or _HOME)
    body = _clean(it.get("text") or it.get("description") or "")
    ident = it.get("id") or f"{hash(url) & 0xFFFFFFFF:x}"
    return {
        "id": f"xueqiu_{ident}",
        "sub": "xueqiu",
        "source_type": "xueqiu",
        "author": user.get("screen_name") or "",
        "title": (body[:120] or "雪球")[:300],
        "selftext": body[:2000],
        "url": url,
        "score": int(it.get("like_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(it.get("reply_count") or 0),
        "created_utc": float((it.get("created_at") or 0)) / 1000.0,
        "is_self": 1,
        "over_18": 0,
        "flair": None,
        "permalink": None,
        "fetched_at": _now_iso(),
    }


def fetch_xueqiu(query: str, limit: int = 50, **_) -> list[dict]:
    """Search Xueqiu statuses for *query* → posts rows. Never raises."""
    q = (query or "").strip()
    if not q:
        return []
    try:
        data = _search(q, limit)
    except Exception:
        return []
    items = (data or {}).get("list") or []
    return [_row(it) for it in items[:limit]]
