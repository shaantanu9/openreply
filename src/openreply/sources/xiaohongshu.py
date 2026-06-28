"""Xiaohongshu (小红书 / RED) — note search. Best-effort, cookie-gated.

XHS is heavily anti-bot (signed `x-s`/`x-t` headers, login wall). There is no
reliable zero-config path: a logged-in `web_session` cookie is required, and even
then the web search endpoint can reject unsigned requests. We attempt it with the
stored cookie and degrade to [] on any failure — honest about the limits. Connect
XHS in Reach Connections (browser login → import cookie) to enable it.

Ported in spirit from agent-reach `channels/xiaohongshu.py` (MIT). Never raises.
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from ..core import credentials as _creds
from ._http import USER_AGENT

_SEARCH = "https://edith.xiaohongshu.com/api/sns/web/v1/search/notes"
_WEB = "https://www.xiaohongshu.com"
_TIMEOUT = 15.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _search(query: str, limit: int, cookie: str) -> dict:
    """POST the XHS note search with the stored cookie. Raises on error."""
    headers = {
        "User-Agent": USER_AGENT,
        "Referer": _WEB + "/",
        "Cookie": cookie,
        "Content-Type": "application/json;charset=UTF-8",
    }
    body = {"keyword": query, "page": 1, "page_size": int(limit),
            "search_id": "", "sort": "general", "note_type": 0}
    with httpx.Client(timeout=_TIMEOUT) as c:
        r = c.post(_SEARCH, headers=headers, json=body)
        r.raise_for_status()
        return r.json()


def _row(it: dict) -> dict:
    note = it.get("note_card") or it.get("note") or it
    nid = it.get("id") or note.get("note_id") or ""
    user = note.get("user") or {}
    url = f"{_WEB}/explore/{nid}" if nid else _WEB
    ident = nid or f"{hash(url) & 0xFFFFFFFF:x}"
    inter = note.get("interact_info") or {}
    return {
        "id": f"xiaohongshu_{ident}",
        "sub": "xiaohongshu",
        "source_type": "xiaohongshu",
        "author": user.get("nickname") or user.get("nick_name") or "",
        "title": (note.get("display_title") or note.get("title") or "")[:300],
        "selftext": (note.get("desc") or "")[:2000],
        "url": url,
        "score": int(inter.get("liked_count") or 0) if str(inter.get("liked_count") or "0").isdigit() else 0,
        "upvote_ratio": None,
        "num_comments": int(inter.get("comment_count") or 0) if str(inter.get("comment_count") or "0").isdigit() else 0,
        "created_utc": 0.0,
        "is_self": 1,
        "over_18": 0,
        "flair": None,
        "permalink": None,
        "fetched_at": _now_iso(),
    }


def fetch_xiaohongshu(query: str, limit: int = 30, **_) -> list[dict]:
    """Search XHS notes for *query* → posts rows. [] without a cookie. Never raises."""
    q = (query or "").strip()
    if not q:
        return []
    cookie = _creds.cookie_header("xiaohongshu")
    if not cookie:
        return []
    try:
        data = _search(q, limit, cookie)
    except Exception:
        return []
    items = (((data or {}).get("data") or {}).get("items")) or []
    rows = [_row(it) for it in items if isinstance(it, dict)]
    return rows[:limit]
