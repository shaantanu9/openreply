"""Reddit fetch cascade shared by fetch/posts.py and fetch/search.py.

Reddit 403-blocks anonymous `.json`. To get the best data available without a
hard failure we cascade through tiers and report which one served:

    1. praw   — PRAW (when Reddit OAuth is connected, config.mode == "auth")
    2. cookie — `.json` via the stored `reddit_session` cookie (+ REDDIT_PROXY);
                full score / num_comments / upvote_ratio
    3. rss    — the public RSS path (titles/bodies only; last-resort, never 403)

Each tier callable returns posts-row dicts (source_type="reddit"); a tier that
raises or returns [] falls through to the next. Returns (rows, tier_name).
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from ..core import credentials as _creds
from ..core.public_client import _proxy

_BASE = "https://www.reddit.com"
_TIMEOUT = 20.0
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _json_row(d: dict) -> dict:
    pid = d.get("id") or ""
    permalink = d.get("permalink") or (
        f"/r/{d.get('subreddit', '')}/comments/{pid}/" if pid else ""
    )
    return {
        "id": pid or f"{hash(d.get('url', '')) & 0xFFFFFFFF:x}",
        "sub": (d.get("subreddit") or "")[:60],
        "source_type": "reddit",
        "author": d.get("author") or "[deleted]",
        "title": (d.get("title") or "")[:300],
        "selftext": (d.get("selftext") or "")[:4000],
        "url": d.get("url") or (f"{_BASE}{permalink}" if permalink else ""),
        "score": int(d.get("score") or 0),
        "upvote_ratio": d.get("upvote_ratio"),
        "num_comments": int(d.get("num_comments") or 0),
        "created_utc": float(d.get("created_utc") or 0.0),
        "is_self": 1 if d.get("is_self") else 0,
        "over_18": 1 if d.get("over_18") else 0,
        "flair": d.get("link_flair_text") or None,
        "permalink": permalink or None,
        "fetched_at": _now_iso(),
    }


def _cookie_get(path: str, params: dict, cookie: str) -> list[dict]:
    headers = {"User-Agent": _UA, "Cookie": cookie, "Accept": "application/json"}
    params = {**params, "raw_json": 1}
    with httpx.Client(proxy=_proxy(), timeout=_TIMEOUT, follow_redirects=True) as c:
        r = c.get(f"{_BASE}{path}", params=params, headers=headers)
        r.raise_for_status()
        data = r.json()
    children = ((data or {}).get("data") or {}).get("children") or []
    return [_json_row(ch["data"]) for ch in children if isinstance(ch, dict) and ch.get("data")]


def cookie_posts(sub: str, sort: str, limit: int, time_filter: str) -> list[dict]:
    cookie = _creds.cookie_header("reddit")
    if not cookie:
        return []
    sort = sort if sort in ("hot", "new", "top", "rising", "controversial") else "hot"
    params: dict = {"limit": min(100, limit)}
    if sort in ("top", "controversial"):
        params["t"] = time_filter
    return _cookie_get(f"/r/{sub}/{sort}.json", params, cookie)


def cookie_search(query: str, sub: str | None, sort: str, time_filter: str, limit: int) -> list[dict]:
    cookie = _creds.cookie_header("reddit")
    if not cookie:
        return []
    path = f"/r/{sub}/search.json" if sub else "/search.json"
    params: dict = {"q": query, "sort": sort, "t": time_filter, "limit": min(100, limit)}
    if sub:
        params["restrict_sr"] = "1"
    return _cookie_get(path, params, cookie)


def run_cascade(tiers: list[tuple[str, object]]) -> tuple[list[dict], str]:
    """Try (name, callable) tiers in order; first non-empty wins. Never raises.
    Returns (rows, served_tier) — ("", []) becomes ([], "none")."""
    for name, fn in tiers:
        try:
            rows = fn()
        except Exception:
            rows = []
        if rows:
            return rows, name
    return [], "none"
