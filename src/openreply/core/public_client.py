"""Public no-auth Reddit client — RSS edition.

Reddit 403-blocks the unauthenticated `.json` API as of 2025 (every
`www.reddit.com/*.json` request returns 403 regardless of User-Agent), but it
STILL serves the public **RSS** feeds (`/*.rss`) without auth or an app key.
So the free, no-OAuth path fetches RSS and parses it with `feedparser`.

What RSS gives us (vs the old .json):
  - ✅ title, author, permalink, created time, self-text body, subreddit
  - ❌ score / upvote_ratio / num_comments (not in RSS → returned as None)
  - ⚠️  ~25 items per search feed, up to ~100 per listing (no deep pagination)

Returned row dicts match the shape produced by `fetch._shape` / the old client
so the rest of the pipeline (SQLite upserts, exporters, MCP tools) is unchanged.
For score-aware / deep collection, connect Reddit OAuth (`openreply auth login`)
which flips `config.mode` to "auth" and uses PRAW instead of this module.
"""
from __future__ import annotations

import calendar
import html
import os
import random
import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from .config import load_config

_BASE = "https://www.reddit.com"
_TIMEOUT = 20.0


def _proxy() -> str | None:
    """Optional proxy for Reddit, to route around server-IP 403/blocks.
    Set REDDIT_PROXY (or config.reddit_proxy) to e.g. http://user:pass@host:port."""
    cfg_proxy = getattr(load_config(), "reddit_proxy", None)
    return cfg_proxy or os.environ.get("REDDIT_PROXY") or None

# Rotating real-browser UAs — Reddit's bot filter 403s bare/repeated UAs even
# on RSS. A real-browser UA per request is what keeps the no-auth path alive.
_BROWSER_UAS = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0",
)

_TAG_RE = re.compile(r"<[^>]+>")
_PID_RE = re.compile(r"/comments/([a-z0-9]+)/", re.I)
_SUB_RE = re.compile(r"/r/([^/]+)/", re.I)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _headers() -> dict[str, str]:
    cfg_ua = load_config().reddit_user_agent or ""
    ua = cfg_ua if (" " in cfg_ua and "/" in cfg_ua) else random.choice(_BROWSER_UAS)
    return {
        "User-Agent": ua,
        "Accept": "application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "DNT": "1",
    }


def _get_rss(path: str, params: dict[str, Any] | None = None):
    """Fetch a Reddit `.rss` feed and return the parsed feedparser object.

    We fetch the bytes ourselves (with browser headers) and hand the text to
    feedparser — feedparser's own fetcher uses a UA Reddit blocks.
    """
    import feedparser

    url = f"{_BASE}{path}"
    backoff = 1.5
    last_err: Exception | None = None
    for attempt in range(4):
        try:
            with httpx.Client(proxy=_proxy(), timeout=_TIMEOUT, follow_redirects=True) as _c:
                r = _c.get(url, params=params, headers=_headers())
            if r.status_code == 429:
                time.sleep(min(float(r.headers.get("Retry-After", "2")), 30))
                continue
            r.raise_for_status()
            return feedparser.parse(r.text)
        except httpx.HTTPError as e:
            last_err = e
            time.sleep(backoff**attempt)
    raise RuntimeError(f"public RSS fetch failed: {url} — {last_err}")


def _get(path: str, params: dict[str, Any] | None = None) -> Any:
    """Legacy JSON GET — kept for back-compat callers (e.g. discover.py's
    `/subreddits/search.json`). Reddit now 403-blocks unauthenticated `.json`,
    so this typically raises; every caller wraps it in try/except and degrades
    (discover falls back to LLM keyword expansion). Raise (don't swallow) so
    those fallbacks trigger."""
    url = f"{_BASE}{path}"
    with httpx.Client(proxy=_proxy(), timeout=_TIMEOUT, follow_redirects=True) as _c:
        r = _c.get(url, params=params, headers=_headers())
    r.raise_for_status()
    return r.json()


# ── entry → row converters ───────────────────────────────────────────────────

def _strip_html(s: str | None) -> str:
    if not s:
        return ""
    return html.unescape(_TAG_RE.sub(" ", s)).strip()


def _author(e: Any, fallback: str = "[deleted]") -> str:
    a = (getattr(e, "author", "") or "").strip().lstrip("/")
    if a.lower().startswith("u/"):
        a = a[2:]
    return a or fallback


def _created_utc(e: Any) -> float | None:
    tp = getattr(e, "updated_parsed", None) or getattr(e, "published_parsed", None)
    return float(calendar.timegm(tp)) if tp else None


def _body(e: Any) -> str:
    content = getattr(e, "content", None)
    if content:
        return _strip_html(content[0].get("value", ""))
    return _strip_html(getattr(e, "summary", "") or "")


def _entry_link(e: Any) -> str:
    return getattr(e, "link", "") or ""


def _post_id(e: Any, link: str) -> str | None:
    eid = getattr(e, "id", "") or ""
    if "_" in eid:  # Reddit fullname e.g. "t3_1lttke6"
        return eid.split("_")[-1]
    m = _PID_RE.search(link)
    return m.group(1) if m else None


def _sub(e: Any, link: str) -> str | None:
    tags = getattr(e, "tags", None) or []
    if tags and tags[0].get("term"):
        return str(tags[0]["term"]).lower()
    m = _SUB_RE.search(link)
    return m.group(1).lower() if m else None


def _is_post_entry(e: Any) -> bool:
    """RSS search feeds mix in subreddit/user suggestions — keep only real posts."""
    return "/comments/" in _entry_link(e)


def _post_row(e: Any) -> dict[str, Any]:
    link = _entry_link(e)
    return {
        "id": _post_id(e, link),
        "sub": _sub(e, link),
        "source_type": "reddit",
        "author": _author(e),
        "title": getattr(e, "title", None),
        "selftext": _body(e),
        "url": link,
        "score": None,          # not exposed by RSS
        "upvote_ratio": None,
        "num_comments": None,
        "created_utc": _created_utc(e),
        "is_self": 1,
        "over_18": 0,
        "flair": None,
        "permalink": link,
        "fetched_at": _now(),
    }


def _comment_row(e: Any, post_id: str | None) -> dict[str, Any]:
    return {
        "id": _post_id(e, _entry_link(e)),
        "post_id": post_id,
        "parent_id": None,      # RSS comment feeds are flat (no tree)
        "author": _author(e),
        "body": _body(e),
        "score": None,
        "created_utc": _created_utc(e),
        "depth": 0,
        "fetched_at": _now(),
    }


# ── endpoints (RSS) ──────────────────────────────────────────────────────────

def public_search(
    query: str,
    sub: str | None = None,
    sort: str = "relevance",
    time_filter: str = "all",
    limit: int = 50,
) -> list[dict]:
    path = f"/r/{sub}/search.rss" if sub else "/search.rss"
    params: dict[str, Any] = {"q": query, "sort": sort, "t": time_filter, "limit": min(100, limit)}
    if sub:
        params["restrict_sr"] = "1"
    feed = _get_rss(path, params=params)
    rows = [_post_row(e) for e in feed.entries if _is_post_entry(e)]
    return rows[:limit]


def public_get_posts(
    sub: str,
    sort: str = "hot",
    limit: int = 50,
    time_filter: str = "day",
) -> list[dict]:
    sort = sort if sort in ("hot", "new", "top", "rising", "controversial") else "hot"
    params: dict[str, Any] = {"limit": min(100, limit)}
    if sort in ("top", "controversial"):
        params["t"] = time_filter
    feed = _get_rss(f"/r/{sub}/{sort}/.rss", params=params)
    rows = [_post_row(e) for e in feed.entries if _is_post_entry(e)]
    return rows[:limit]


def public_get_comments(post_id: str, depth: int | None = None) -> tuple[dict | None, list[dict]]:
    """Returns (post_row | None, comment_rows). RSS gives a flat comment list
    with no tree and no scores; the OP row isn't separable, so post is None."""
    feed = _get_rss(f"/comments/{post_id}/.rss", params={"limit": 500})
    rows = [_comment_row(e, post_id) for e in feed.entries]
    return None, rows


def public_search_subreddits(query: str, limit: int = 25) -> list[str]:  # convenience
    """Subreddit names matching a query (from the all-Reddit search suggestions)."""
    feed = _get_rss("/search.rss", params={"q": query, "type": "sr", "limit": min(100, limit)})
    subs: list[str] = []
    for e in feed.entries:
        m = _SUB_RE.search(_entry_link(e))
        if m and "/comments/" not in _entry_link(e):
            subs.append(m.group(1).lower())
    return list(dict.fromkeys(subs))[:limit]


def public_get_sub_comments(sub: str, limit: int = 100) -> list[dict]:
    """Recent comments across a subreddit (pain quotes live here, not OPs)."""
    feed = _get_rss(f"/r/{sub}/comments/.rss", params={"limit": min(100, limit)})
    out: list[dict] = []
    for e in feed.entries:
        m = _PID_RE.search(_entry_link(e))
        out.append(_comment_row(e, m.group(1) if m else None))
    return out[:limit]


def public_get_user(name: str, kind: str = "both", limit: int = 100) -> dict:
    out: dict = {"user": {"name": name, "fetched_at": _now()}, "posts": [], "comments": []}
    if kind in ("posts", "both"):
        feed = _get_rss(f"/user/{name}/submitted/.rss", params={"limit": min(100, limit)})
        out["posts"] = [_post_row(e) for e in feed.entries if _is_post_entry(e)][:limit]
    if kind in ("comments", "both"):
        feed = _get_rss(f"/user/{name}/comments/.rss", params={"limit": min(100, limit)})
        rows: list[dict] = []
        for e in feed.entries:
            m = _PID_RE.search(_entry_link(e))
            rows.append(_comment_row(e, m.group(1) if m else None))
        out["comments"] = rows[:limit]
    return out
