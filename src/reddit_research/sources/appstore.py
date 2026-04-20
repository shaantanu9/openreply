"""iOS App Store — app discovery via iTunes Search API + reviews via the
same token-authed `/v1/catalog/.../reviews` endpoint the App Store app
itself uses.

Reviews implementation adapted from glennfang/apple-app-reviews-scraper
(MIT). We inline it instead of installing the package because the upstream
repo doesn't ship setup.py/pyproject.toml. The flow:

  1. GET https://apps.apple.com/<country>/app/<slug>/id<id> — HTML contains
     a bearer token in a <meta> web-experience-app/config/environment tag.
  2. GET https://amp-api.apps.apple.com/v1/catalog/<country>/apps/<id>/reviews
     with Authorization: bearer <token>. Paginated via ?offset=N (limit 20).
  3. Repeat until `result.next` is None or we hit max_reviews.

This replaces the older iTunes RSS feed which IP-throttles aggressively
(~30-60 req/min) and frequently returns empty pages. The token-authed
endpoint has been tested to ~15k reviews per session with no rate-limit
issues when a 0.5s sleep is left between calls.

Endpoints:
  - https://itunes.apple.com/search?term=X&entity=software
  - https://amp-api.apps.apple.com/v1/catalog/<country>/apps/<id>/reviews
"""
from __future__ import annotations

import random
import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx

_SEARCH = "https://itunes.apple.com/search"
_LANDING_URL = "https://apps.apple.com/{country}/app/{slug}/id{track_id}"
_REVIEWS_API = "https://amp-api.apps.apple.com/v1/catalog/{country}/apps/{track_id}/reviews"
# RSS fallback — still works when the v1 token fetch fails (which is the
# current state after Apple's 2024 page-structure change that removed the
# web-experience-app/config/environment meta tag). RSS IP-throttles but
# gives us SOMETHING for the 80% case where a topic only needs recent
# reviews from a few apps.
_RSS = "https://itunes.apple.com/{country}/rss/customerreviews/page={page}/id={track_id}/sortby=mostrecent/json"

# Rotating UA pool — the token-fetch request fails less often when the
# User-Agent rotates across common desktop browsers. Used by _get_token()
# and for each reviews page request.
_UA_POOL = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
]

# Per-process token cache. Tokens are valid for the lifetime of the sidecar
# process (they don't change frequently on Apple's side). Re-fetched only
# when the reviews endpoint returns 401.
_TOKEN_CACHE: dict[str, str] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def search_appstore_apps(
    topic: str, country: str = "us", limit: int = 10
) -> list[dict]:
    """Return top matching iOS apps for a topic keyword."""
    from ._http import DEFAULT_HEADERS
    try:
        r = httpx.get(
            _SEARCH,
            params={
                "term": topic,
                "entity": "software",
                "country": country,
                "limit": min(limit, 50),
            },
            timeout=15,
            headers=DEFAULT_HEADERS,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    results = r.json().get("results") or []
    return [
        {
            "track_id": a.get("trackId"),
            "name": a.get("trackName"),
            "seller": a.get("sellerName"),
            "genres": a.get("genres"),
            "price": a.get("formattedPrice"),
            "rating": a.get("averageUserRating"),
            "rating_count": a.get("userRatingCount"),
            "url": a.get("trackViewUrl"),
            "bundle_id": a.get("bundleId"),
            "description": a.get("description") or "",
        }
        for a in results[:limit]
    ]


def _slugify_app_name(name: str) -> str:
    """Best-effort slug for the landing URL. Apple routes by track_id so any
    slug (even an incorrect one) serves the correct page — but we send a
    clean one to minimize redirect hops."""
    s = re.sub(r"[^a-zA-Z0-9]+", "-", (name or "app").lower()).strip("-")
    return s[:60] or "app"


def _get_token(track_id: int, app_name: str, country: str) -> str | None:
    """Scrape the bearer token from the app's landing page HTML.

    Returns None on failure (HTTP error, no token in page). Callers should
    fall back to the RSS feed or skip.
    """
    cache_key = f"{country}:{track_id}"
    if cache_key in _TOKEN_CACHE:
        return _TOKEN_CACHE[cache_key]

    slug = _slugify_app_name(app_name)
    url = _LANDING_URL.format(country=country, slug=slug, track_id=track_id)
    try:
        r = httpx.get(
            url,
            headers={"User-Agent": random.choice(_UA_POOL)},
            timeout=15,
            follow_redirects=True,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return None

    # The token lives in a <meta> tag whose name matches the regex:
    #   <meta.*web-experience-app/config/environment
    # The token itself is URL-encoded inside a JSON string in that tag's
    # content, between `token%22%3A%22` and the next `%22`.
    for line in r.text.splitlines():
        if re.match(r"<meta.+web-experience-app/config/environment", line):
            m = re.search(r"token%22%3A%22(.+?)%22", line)
            if m:
                tok = m.group(1)
                _TOKEN_CACHE[cache_key] = tok
                return tok
    return None


def _review_row_v1(d: dict[str, Any], app_name: str, track_id: int) -> dict[str, Any]:
    """Map a v1 API review object to our posts-table row shape.

    v1 response shape:
      { "id": "<review_id>",
        "type": "user-reviews",
        "attributes": {
          "date": "2024-01-02T12:34:56Z",
          "userName": "someuser",
          "title": "Great app",
          "review": "Body text...",
          "rating": 5
        } }
    """
    attrs = d.get("attributes") or {}
    rid = d.get("id") or ""
    title = (attrs.get("title") or "").strip()
    body = (attrs.get("review") or "").strip()
    rating = int(attrs.get("rating") or 0)
    author = (attrs.get("userName") or "").strip() or "[anon]"
    date_str = attrs.get("date") or ""
    try:
        ts = datetime.fromisoformat(date_str.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        ts = 0.0
    return {
        "id": f"appstore_{track_id}_{rid}",
        "sub": f"appstore:{(app_name or '').strip()[:50]}",
        "source_type": "appstore",
        "author": author,
        "title": title,
        "selftext": body,
        "url": f"https://apps.apple.com/app/id{track_id}",
        "score": rating,
        "upvote_ratio": None,
        "num_comments": 0,
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": f"★{rating}",
        "permalink": f"https://apps.apple.com/app/id{track_id}",
        "fetched_at": _now_iso(),
    }


def _review_row_rss(d: dict[str, Any], app_name: str, track_id: int) -> dict[str, Any]:
    """RSS entries are formatted with nested {"label": "..."} — flatten."""
    def lv(x, field="label"):
        if isinstance(x, dict):
            return x.get(field, "")
        return x or ""
    rid = lv(d.get("id"))
    title = lv(d.get("title"))
    body = lv(d.get("content"))
    rating = int(lv(d.get("im:rating")) or 0)
    author_meta = d.get("author") or {}
    author = lv(author_meta.get("name")) if isinstance(author_meta, dict) else str(author_meta)
    updated = lv(d.get("updated"))
    try:
        ts = datetime.fromisoformat(updated.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        ts = 0.0
    return {
        "id": f"appstore_{track_id}_{rid}",
        "sub": f"appstore:{(app_name or '').strip()[:50]}",
        "source_type": "appstore",
        "author": author or "[anon]",
        "title": title,
        "selftext": body,
        "url": f"https://apps.apple.com/app/id{track_id}",
        "score": rating,
        "upvote_ratio": None,
        "num_comments": 0,
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": f"★{rating}",
        "permalink": f"https://apps.apple.com/app/id{track_id}",
        "fetched_at": _now_iso(),
    }


def _fetch_reviews_rss(
    track_id: int, app_name: str, country: str, pages: int, max_reviews: int,
) -> list[dict]:
    """Legacy RSS-feed path. Used as fallback when v1 token fetch fails.

    IMPORTANT: Apple's RSS feed soft-blocks our polite `reddit-myind/0.1 …`
    UA by returning an empty entries list (200 OK + zero rows). A browser
    UA gets the full feed. Rotating across _UA_POOL reduces the chance
    of per-UA rate-limit.
    """
    rows: list[dict] = []
    for page in range(1, pages + 1):
        if len(rows) >= max_reviews:
            break
        url = _RSS.format(country=country, page=page, track_id=track_id)
        try:
            r = httpx.get(
                url,
                timeout=15,
                headers={"User-Agent": random.choice(_UA_POOL), "Accept": "application/json"},
            )
            r.raise_for_status()
        except httpx.HTTPError:
            break
        feed = r.json().get("feed") or {}
        entries = feed.get("entry") or []
        # First entry is app metadata, skip it
        if isinstance(entries, list) and entries and entries[0].get("im:name"):
            entries = entries[1:]
        if not entries:
            break
        for e in entries:
            row = _review_row_rss(e, app_name or f"app_{track_id}", track_id)
            if row["id"]:
                rows.append(row)
                if len(rows) >= max_reviews:
                    break
        time.sleep(2.0)  # politeness — RSS throttles hard
    return rows


def fetch_appstore_reviews(
    track_id: int,
    app_name: str = "",
    country: str = "us",
    pages: int = 10,
    max_reviews: int = 500,
) -> list[dict]:
    """Fetch reviews for an iOS app. Tries Apple's token-authed v1 API first
    (used by the App Store app itself — 15k reviews/session headroom), then
    falls back to the RSS feed if token extraction fails (Apple removed the
    HTML-embedded token ~2024, which breaks the v1 path for most apps)."""
    token = _get_token(track_id, app_name, country)
    if not token:
        # v1 token unreachable — fall back to RSS. Still works for recent
        # reviews of most apps, just slower + throttle-prone.
        return _fetch_reviews_rss(track_id, app_name, country, pages, max_reviews)

    landing = _LANDING_URL.format(
        country=country, slug=_slugify_app_name(app_name), track_id=track_id
    )
    api_url = _REVIEWS_API.format(country=country, track_id=track_id)

    rows: list[dict] = []
    offset: str | None = "1"
    MAX_RETRIES = 5
    BASE_DELAY = 10
    seen_ids: set[str] = set()

    # Cap the loop at `pages` iterations so a buggy server loop can't spin
    # forever. Each request returns up to 20 reviews.
    for _ in range(max(pages, 1) * 4):  # 4× so pages=10 yields 40 requests × 20 = 800 review cap
        if offset is None or len(rows) >= max_reviews:
            break

        headers = {
            "Accept": "application/json",
            "Authorization": f"bearer {token}",
            "Connection": "keep-alive",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Origin": "https://apps.apple.com",
            "Referer": landing,
            "User-Agent": random.choice(_UA_POOL),
        }
        params = {
            "l": "en-GB",
            "offset": str(offset),
            "limit": "20",
            "platform": "web",
            "additionalPlatforms": "appletv,ipad,iphone,mac",
        }

        retry_count = 0
        result: dict[str, Any] = {"data": [], "next": None}
        status = 0
        while retry_count < MAX_RETRIES:
            try:
                r = httpx.get(api_url, headers=headers, params=params, timeout=20)
                status = r.status_code
            except httpx.HTTPError:
                break
            if status == 200:
                try:
                    result = r.json()
                except ValueError:
                    result = {"data": [], "next": None}
                break
            if status == 401:
                # Token expired — clear cache + re-fetch once.
                _TOKEN_CACHE.pop(f"{country}:{track_id}", None)
                token = _get_token(track_id, app_name, country) or ""
                if not token:
                    return rows  # give up, return what we have
                headers["Authorization"] = f"bearer {token}"
                retry_count += 1
                continue
            if status == 429:
                retry_count += 1
                time.sleep(BASE_DELAY * retry_count)
                continue
            if status == 404:
                # No more reviews — Apple signals end-of-list with 404.
                offset = None
                break
            # Other status codes — bail this page.
            break

        batch = result.get("data") or []
        if not batch:
            break

        for rev in batch:
            row = _review_row_v1(rev, app_name or f"app_{track_id}", track_id)
            if not row["id"] or row["id"] in seen_ids:
                continue
            seen_ids.add(row["id"])
            rows.append(row)
            if len(rows) >= max_reviews:
                break

        # Next offset from result.next (URL containing ?offset=N)
        nxt = result.get("next")
        if isinstance(nxt, str):
            m = re.search(r"offset=(\d+)", nxt)
            offset = m.group(1) if m else None
        else:
            offset = None

        # Politeness sleep between pages — keeps us well under the rate limit.
        time.sleep(0.5)

    return rows
