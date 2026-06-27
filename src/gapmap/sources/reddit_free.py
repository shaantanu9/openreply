"""Reddit (free) — cookie/proxy JSON with RSS fallback. No paid API.

Reddit 403-blocks anonymous `.json`. This source gives full-fidelity rows
(score, num_comments, upvote_ratio) when a `reddit_session` cookie is connected
via Reach Connections, routing through `REDDIT_PROXY` if set. With no cookie it
falls back to the RSS public path (titles/bodies only — no scores). Rows are
tagged `source_type="reddit_free"` and registered in the Reddit family so the
app treats them like native Reddit posts. Never raises.
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from ..core import credentials as _creds
from ..core.public_client import _proxy, public_search

_BASE = "https://www.reddit.com"
_TIMEOUT = 20.0
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _authed_search(query: str, sub: str | None, limit: int, cookie: str, sort: str = "new") -> dict:
    """Authenticated search.json via the stored cookie (+ proxy). Raises on error."""
    path = f"/r/{sub}/search.json" if sub else "/search.json"
    params = {"q": query, "limit": min(100, limit), "raw_json": 1, "sort": sort}
    if sub:
        params["restrict_sr"] = "1"
    headers = {"User-Agent": _UA, "Cookie": cookie, "Accept": "application/json"}
    with httpx.Client(proxy=_proxy(), timeout=_TIMEOUT, follow_redirects=True) as c:
        r = c.get(f"{_BASE}{path}", params=params, headers=headers)
        r.raise_for_status()
        return r.json()


def _row(d: dict) -> dict:
    pid = d.get("id") or ""
    permalink = d.get("permalink") or (f"/r/{d.get('subreddit','')}/comments/{pid}/" if pid else "")
    return {
        "id": pid or f"{hash(d.get('url','')) & 0xFFFFFFFF:x}",
        "sub": (d.get("subreddit") or "")[:60],
        "source_type": "reddit_free",
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


def fetch_reddit_free(query: str, sub: str | None = None, limit: int = 50,
                      sort: str = "new", **_) -> list[dict]:
    """Search Reddit for *query* → posts rows. Cookie JSON if connected, else RSS.

    `sort` controls recency vs relevance ("new" | "relevance" | "hot" | "top" |
    "comments"); defaults to "new" so outreach surfaces fresh, still-replyable
    threads (older threads score 0 on freshness and are effectively dead leads).
    Never raises."""
    q = (query or "").strip()
    if not q:
        return []
    cookie = _creds.cookie_header("reddit")
    if cookie:
        try:
            data = _authed_search(q, sub, limit, cookie, sort=sort)
            children = ((data or {}).get("data") or {}).get("children") or []
            rows = [_row(c["data"]) for c in children if isinstance(c, dict) and c.get("data")]
            if rows:
                return rows[:limit]
        except Exception:
            pass  # fall through to RSS
    # RSS fallback — retag provenance as reddit_free.
    try:
        rss = public_search(q, sub=sub, sort=sort, limit=limit)
    except Exception:
        return []
    for r in rss:
        r["source_type"] = "reddit_free"
    return rss[:limit]
