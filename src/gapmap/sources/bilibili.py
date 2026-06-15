"""Bilibili — public web search API. Zero-config (optional BILIBILI_PROXY).

Bilibili is China's largest video community. The public search endpoint
(`/x/web-interface/search/all/v2`) returns video results without login. Some
server IPs get risk-controlled (HTTP 412); set `BILIBILI_PROXY` to route around
it. yt-dlp does NOT work for bilibili (risk control blocks it) — this is the
search-only path; subtitle extraction would need a logged-in session (future).

Ported from agent-reach `channels/bilibili.py` (MIT) into the posts-row
contract. Never raises — returns [].
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone

import httpx

from ._http import USER_AGENT

_SEARCH = "https://api.bilibili.com/x/web-interface/search/all/v2"
_TAG_RE = re.compile(r"<[^>]+>")
_TIMEOUT = 15.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _strip(s: str) -> str:
    return _TAG_RE.sub("", s or "")


def _get_json(url: str, params: dict) -> dict:
    """GET JSON from the bilibili API, optionally via BILIBILI_PROXY. Raises on error."""
    proxy = os.environ.get("BILIBILI_PROXY") or None
    headers = {
        "User-Agent": USER_AGENT,
        "Referer": "https://www.bilibili.com/",
    }
    with httpx.Client(proxy=proxy, timeout=_TIMEOUT, follow_redirects=True) as c:
        r = c.get(url, params=params, headers=headers)
        r.raise_for_status()
        return r.json()


def _video_row(it: dict) -> dict:
    bvid = it.get("bvid") or ""
    url = f"https://www.bilibili.com/video/{bvid}" if bvid else (it.get("arcurl") or "")
    ident = bvid or f"{hash(url) & 0xFFFFFFFF:x}"
    return {
        "id": f"bilibili_{ident}",
        "sub": (it.get("typename") or "bilibili")[:60],
        "source_type": "bilibili",
        "author": it.get("author") or "",
        "title": _strip(it.get("title") or "")[:300],
        "selftext": _strip(it.get("description") or "")[:2000],
        "url": url,
        "score": int(it.get("play") or 0),
        "upvote_ratio": None,
        "num_comments": int(it.get("review") or it.get("danmaku") or 0),
        "created_utc": float(it.get("pubdate") or it.get("senddate") or 0.0),
        "is_self": 0,
        "over_18": 0,
        "flair": (it.get("typename") or None),
        "permalink": None,
        "fetched_at": _now_iso(),
    }


def fetch_bilibili(query: str, limit: int = 50, **_) -> list[dict]:
    """Search bilibili videos for *query* → posts rows. Never raises."""
    q = (query or "").strip()
    if not q:
        return []
    try:
        data = _get_json(_SEARCH, {"keyword": q, "page": 1})
    except Exception:
        return []
    if not isinstance(data, dict) or data.get("code") != 0:
        return []
    groups = ((data.get("data") or {}).get("result")) or []
    videos: list[dict] = []
    for g in groups:
        if isinstance(g, dict) and g.get("result_type") == "video":
            videos = g.get("data") or []
            break
    return [_video_row(v) for v in videos[:limit]]
