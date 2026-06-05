"""Generic RSS/Atom feed adapter.

Fetches any feed via `feedparser`, filters entries by topic keyword match
(case-insensitive substring in title + summary), and returns the common
`posts` row shape used by every other source.

No API keys. No rate limits beyond per-host politeness (enforced in the
collect adapter by looping one feed at a time with a short sleep).
"""
from __future__ import annotations

import calendar
import hashlib
import ipaddress
import re
import socket
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from ._http import DEFAULT_HEADERS, DEFAULT_TIMEOUT

import httpx


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _require_feedparser():
    try:
        import feedparser  # type: ignore
    except ImportError as e:  # pragma: no cover - sources extra is always installed in the sidecar
        raise RuntimeError("Install sources extra: pip install -e '.[sources]'") from e
    return feedparser


def _stable_id(feed_url: str, entry_id: str) -> str:
    """Deterministic, URL-safe id for posts dedup. hashlib avoids relying on
    Python's hash() which is PYTHONHASHSEED-salted between runs.
    """
    h = hashlib.sha1(f"{feed_url}::{entry_id}".encode("utf-8")).hexdigest()[:16]
    return f"rss_{h}"


def _entry_to_row(entry, feed_url: str, publication: str, category: str) -> dict[str, Any]:
    rid = entry.get("id") or entry.get("link") or entry.get("title") or ""
    ts = 0.0
    for key in ("published_parsed", "updated_parsed"):
        val = getattr(entry, key, None) or entry.get(key)
        if val:
            try:
                ts = float(calendar.timegm(val))
                break
            except (TypeError, ValueError):
                pass
    # feedparser exposes summary in multiple shapes; prefer the cleanest.
    summary = (
        entry.get("summary")
        or (entry.get("content", [{}])[0].get("value") if entry.get("content") else "")
        or ""
    )
    return {
        "id": _stable_id(feed_url, rid),
        "sub": f"rss:{category}",
        "source_type": "rss",
        "author": publication or "rss",
        "title": (entry.get("title") or "")[:300],
        "selftext": summary[:2000],
        "url": entry.get("link") or feed_url,
        "score": 0,
        "upvote_ratio": None,
        "num_comments": 0,
        "created_utc": ts,
        "is_self": 0,
        "over_18": 0,
        "flair": publication[:100] if publication else None,
        # IMPORTANT: leave permalink None for non-Reddit sources. The
        # frontend prepends https://www.reddit.com to permalink when
        # set, so storing an arbitrary article URL here produced
        # broken cross-domain links. The article URL lives in `url`.
        "permalink": None,
        "fetched_at": _now_iso(),
    }


def _matches_query(row: dict[str, Any], query: str | list[str] | None) -> bool:
    """RSS relevance matcher.

    Old behavior required the full query phrase as a literal substring in
    title/summary, which over-filtered feeds for normal topics
    ("ai product analytics", "calorie tracking app", etc.). We now accept:
      - full-phrase hit, OR
      - token overlap hit:
          * single-token query  -> at least 1 token match
          * multi-token query   -> at least 2 token matches
    """
    if query is None:
        return True
    queries = [query] if isinstance(query, str) else list(query or [])
    queries = [str(q).strip().lower() for q in queries if str(q).strip()]
    if not queries:
        return True
    hay = f"{row.get('title') or ''} {row.get('selftext') or ''}".lower()
    for q in queries:
        if q in hay:
            return True
        tokens = [t for t in re.findall(r"[a-z0-9]+", q) if len(t) >= 3]
        if not tokens:
            continue
        hits = sum(1 for t in set(tokens) if t in hay)
        need = 1 if len(set(tokens)) == 1 else 2
        if hits >= need:
            return True
    return False


def fetch_rss(
    feed_url: str,
    *,
    query: str | list[str] | None = None,
    publication: str = "",
    category: str = "rss",
    limit: int = 30,
) -> list[dict]:
    """Fetch one RSS feed. If `query` is given, filter entries by
    case-insensitive substring match in title OR summary.

    Returns [] on any network/parse error — adapter-level logging handles
    the "one feed was flaky" case without killing the whole collect.
    """
    feedparser = _require_feedparser()
    try:
        r = httpx.get(
            feed_url,
            headers=DEFAULT_HEADERS,
            # RSS endpoints vary wildly in latency; keep per-feed timeout short
            # so one dead publication doesn't stall the entire category bundle.
            timeout=min(DEFAULT_TIMEOUT, 10.0),
            follow_redirects=True,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []

    feed = feedparser.parse(r.text)
    entries = feed.entries or []
    if not entries:
        return []

    rows = [_entry_to_row(e, feed_url, publication, category) for e in entries]
    if query:
        rows = [row for row in rows if _matches_query(row, query)]
    return rows[:limit]


def _is_safe_feed_url(url: str) -> tuple[bool, str]:
    """Allow only http(s) to a public host. Blocks localhost / private /
    link-local / reserved IPs (SSRF defense-in-depth for a user-pasted URL —
    the fetch runs locally on the user's machine, but we still refuse internal
    targets so a feed URL can't probe the LAN)."""
    try:
        p = urlparse(url)
    except Exception:
        return (False, "could not parse URL")
    if p.scheme not in ("http", "https"):
        return (False, "URL must start with http:// or https://")
    host = (p.hostname or "").strip()
    if not host:
        return (False, "URL has no host")
    low = host.lower()
    if low == "localhost" or low.endswith(".local"):
        return (False, "local addresses are not allowed")
    try:
        for info in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return (False, "private / internal addresses are not allowed")
    except socket.gaierror:
        return (False, "host did not resolve")
    except Exception:
        pass  # transient resolver hiccup — let the fetch try; it fails safely
    return (True, "")


def validate_feed(url: str) -> dict:
    """Validate a candidate user feed: scheme/SSRF guard → fetch → parse.

    Returns {ok, url, title, entries, error}. The `feeds add` flow calls this
    BEFORE persisting so a non-feed / blocked / Cloudflare-walled URL never gets
    stored and silently contributes nothing on every collect.
    """
    url = (url or "").strip()
    if not url:
        return {"ok": False, "url": url, "error": "URL is required"}
    safe, why = _is_safe_feed_url(url)
    if not safe:
        return {"ok": False, "url": url, "error": why}
    feedparser = _require_feedparser()
    try:
        r = httpx.get(url, headers=DEFAULT_HEADERS,
                      timeout=min(DEFAULT_TIMEOUT, 12.0), follow_redirects=True)
    except httpx.HTTPError as e:
        return {"ok": False, "url": url, "error": f"could not reach feed: {e}"}
    if r.status_code == 403:
        return {"ok": False, "url": url,
                "error": "the site blocks automated fetching (HTTP 403) — many "
                         "review sites (G2, Capterra, AlternativeTo) are "
                         "Cloudflare-walled and can't be used as feeds"}
    if r.status_code >= 400:
        return {"ok": False, "url": url, "error": f"feed returned HTTP {r.status_code}"}
    feed = feedparser.parse(r.text)
    entries = feed.entries or []
    if not entries:
        return {"ok": False, "url": url,
                "error": "no items found — this doesn't look like an RSS/Atom feed"}
    title = ""
    try:
        title = (feed.feed.get("title") or "").strip()
    except Exception:
        pass
    return {"ok": True, "url": url, "title": title,
            "entries": len(entries), "error": ""}
