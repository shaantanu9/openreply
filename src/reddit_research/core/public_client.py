"""Public-JSON fallback client — no OAuth, no client_id, no approval required.

Hits https://www.reddit.com/<path>.json directly. Limits vs the authed API:
  - ~60 req/min per IP (vs 100/min OAuth)
  - No private subs, no modmail, no streaming
  - User pages only expose public listings

Returned row dicts match the shape produced by `fetch._shape` so the rest of
the pipeline (SQLite upserts, exporters, MCP tools) doesn't care which mode
was used.
"""
from __future__ import annotations

import random
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from .config import load_config

_BASE = "https://www.reddit.com"
_TIMEOUT = 20.0

# Rotating real-browser UAs — Reddit's bot filter 403s bare/repeated UAs.
# Strategy borrowed from the `yars` project (datavorous/yars) which is the
# best-known no-auth Reddit scraper still working in 2026.
_BROWSER_UAS = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _headers() -> dict[str, str]:
    """Return headers that Reddit's 2026 bot filter accepts.

    If the user set REDDIT_USER_AGENT to a descriptive value (contains a space
    or parens), we honour it. Otherwise we pick a random real-browser UA per
    request — this is what every still-working no-auth scraper does.
    """
    cfg_ua = load_config().reddit_user_agent or ""
    ua = cfg_ua if (" " in cfg_ua and "/" in cfg_ua) else random.choice(_BROWSER_UAS)
    return {
        "User-Agent": ua,
        "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "DNT": "1",
    }


def _get(path: str, params: dict[str, Any] | None = None) -> Any:
    url = f"{_BASE}{path}"
    backoff = 1.5
    last_err: Exception | None = None
    for attempt in range(4):
        try:
            r = httpx.get(url, params=params, headers=_headers(), timeout=_TIMEOUT, follow_redirects=True)
            if r.status_code == 429:
                # polite backoff per Reddit's Retry-After
                wait = float(r.headers.get("Retry-After", "2"))
                time.sleep(min(wait, 30))
                continue
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError as e:
            last_err = e
            time.sleep(backoff**attempt)
    raise RuntimeError(f"public fetch failed: {url} — {last_err}")


# ── shape converters ─────────────────────────────────────────────────────────

def _post_row(d: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": d.get("id"),
        "sub": (d.get("subreddit") or "").lower() or None,
        "source_type": "reddit",
        "author": d.get("author") or "[deleted]",
        "title": d.get("title"),
        "selftext": d.get("selftext") or "",
        "url": d.get("url"),
        "score": d.get("score"),
        "upvote_ratio": d.get("upvote_ratio"),
        "num_comments": d.get("num_comments"),
        "created_utc": d.get("created_utc"),
        "is_self": int(bool(d.get("is_self"))),
        "over_18": int(bool(d.get("over_18"))),
        "flair": d.get("link_flair_text"),
        "permalink": f"{_BASE}{d['permalink']}" if d.get("permalink") else None,
        "fetched_at": _now(),
    }


def _comment_row(d: dict[str, Any], post_id: str, depth: int) -> dict[str, Any]:
    return {
        "id": d.get("id"),
        "post_id": post_id,
        "parent_id": d.get("parent_id"),
        "author": d.get("author") or "[deleted]",
        "body": d.get("body") or "",
        "score": d.get("score"),
        "created_utc": d.get("created_utc"),
        "depth": depth,
        "fetched_at": _now(),
    }


# ── endpoints ────────────────────────────────────────────────────────────────

def public_get_posts(
    sub: str,
    sort: str = "hot",
    limit: int = 50,
    time_filter: str = "day",
) -> list[dict]:
    # Reddit caps limit at 100 per page — paginate via `after` for more.
    out: list[dict] = []
    after: str | None = None
    remaining = limit
    while remaining > 0:
        page_size = min(100, remaining)
        params: dict[str, Any] = {"limit": page_size, "raw_json": 1}
        if sort in ("top", "controversial"):
            params["t"] = time_filter
        if after:
            params["after"] = after
        j = _get(f"/r/{sub}/{sort}.json", params=params)
        children = j.get("data", {}).get("children", [])
        if not children:
            break
        for c in children:
            if c.get("kind") == "t3":
                out.append(_post_row(c["data"]))
        after = j.get("data", {}).get("after")
        remaining -= len(children)
        if not after:
            break
    return out[:limit]


def public_get_comments(post_id: str, depth: int | None = None) -> tuple[dict | None, list[dict]]:
    """Returns (post_row | None, comments_rows). Public endpoint returns both."""
    j = _get(f"/comments/{post_id}.json", params={"raw_json": 1, "limit": 500})
    if not isinstance(j, list) or len(j) < 2:
        return None, []

    post = None
    post_children = j[0].get("data", {}).get("children", [])
    if post_children and post_children[0].get("kind") == "t3":
        post = _post_row(post_children[0]["data"])

    rows: list[dict] = []

    def _walk(listing: dict, cur_depth: int) -> None:
        if depth is not None and cur_depth > depth:
            return
        for c in listing.get("data", {}).get("children", []):
            if c.get("kind") != "t1":
                continue  # skip `more` stubs — the public API doesn't let us expand them
            d = c["data"]
            rows.append(_comment_row(d, post_id=post_id, depth=cur_depth))
            replies = d.get("replies")
            if isinstance(replies, dict):
                _walk(replies, cur_depth + 1)

    _walk(j[1], 0)
    return post, rows


def public_search(
    query: str,
    sub: str | None = None,
    sort: str = "relevance",
    time_filter: str = "all",
    limit: int = 50,
) -> list[dict]:
    path = f"/r/{sub}/search.json" if sub else "/search.json"
    params: dict[str, Any] = {
        "q": query,
        "sort": sort,
        "t": time_filter,
        "limit": min(100, limit),
        "raw_json": 1,
    }
    if sub:
        params["restrict_sr"] = "on"
    j = _get(path, params=params)
    children = j.get("data", {}).get("children", [])
    return [_post_row(c["data"]) for c in children if c.get("kind") == "t3"][:limit]


def public_get_sub_comments(sub: str, limit: int = 100) -> list[dict]:
    """Firehose of a sub's most recent comments — pain quotes live here, not OPs.

    Uses /r/<sub>/comments.json. No comment tree, just a flat recent-first list.
    Shape matches `_comment_row`; post_id is extracted from `link_id` (t3_ prefix stripped).
    """
    out: list[dict] = []
    after: str | None = None
    remaining = limit
    while remaining > 0:
        page = min(100, remaining)
        params: dict[str, Any] = {"limit": page, "raw_json": 1}
        if after:
            params["after"] = after
        j = _get(f"/r/{sub}/comments.json", params=params)
        children = j.get("data", {}).get("children", [])
        if not children:
            break
        for c in children:
            if c.get("kind") != "t1":
                continue
            d = c["data"]
            link_id = d.get("link_id") or ""
            post_id = link_id[3:] if link_id.startswith("t3_") else link_id
            out.append(
                {
                    "id": d.get("id"),
                    "post_id": post_id,
                    "parent_id": d.get("parent_id"),
                    "author": d.get("author") or "[deleted]",
                    "body": d.get("body") or "",
                    "score": d.get("score"),
                    "created_utc": d.get("created_utc"),
                    "depth": 0,
                    "fetched_at": _now(),
                }
            )
        after = j.get("data", {}).get("after")
        remaining -= len(children)
        if not after:
            break
    return out[:limit]


def public_get_user(name: str, kind: str = "both", limit: int = 100) -> dict:
    out: dict = {"user": None, "posts": [], "comments": []}

    # Profile (may 404 for deleted / banned users)
    try:
        prof = _get(f"/user/{name}/about.json", params={"raw_json": 1}).get("data", {})
        out["user"] = {
            "name": prof.get("name") or name,
            "link_karma": prof.get("link_karma"),
            "comment_karma": prof.get("comment_karma"),
            "created_utc": prof.get("created_utc"),
            "is_mod": int(bool(prof.get("is_mod"))),
            "fetched_at": _now(),
        }
    except Exception:
        out["user"] = {"name": name, "fetched_at": _now()}

    if kind in ("posts", "both"):
        j = _get(f"/user/{name}/submitted.json", params={"limit": min(100, limit), "raw_json": 1})
        for c in j.get("data", {}).get("children", []):
            if c.get("kind") == "t3":
                out["posts"].append(_post_row(c["data"]))

    if kind in ("comments", "both"):
        j = _get(f"/user/{name}/comments.json", params={"limit": min(100, limit), "raw_json": 1})
        for c in j.get("data", {}).get("children", []):
            if c.get("kind") == "t1":
                out["comments"].append(
                    _comment_row(c["data"], post_id=(c["data"].get("link_id") or "").replace("t3_", ""), depth=0)
                )

    return out
