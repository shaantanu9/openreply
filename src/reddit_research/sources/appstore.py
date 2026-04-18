"""iOS App Store — app discovery via iTunes Search API + reviews via RSS feed.

Both endpoints are free and require no auth. Reviews RSS gives up to ~500 most
recent reviews per app, paginated across ~10 pages of ~50.

⚠ KNOWN LIMITATION: iTunes RSS IP-throttles aggressively (~30–60 req/min per IP).
Once tripped, it returns an empty feed for 15–30 min. Mitigation: ≥2s sleep
between pages, run fewer apps at once, or cool-off if results go to zero.

Endpoints:
  - https://itunes.apple.com/search?term=X&entity=software
  - https://itunes.apple.com/<country>/rss/customerreviews/page=N/id=<trackId>/sortby=mostrecent/json
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import httpx

_SEARCH = "https://itunes.apple.com/search"
_RSS = "https://itunes.apple.com/{country}/rss/customerreviews/page={page}/id={track_id}/sortby=mostrecent/json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def search_appstore_apps(
    topic: str, country: str = "us", limit: int = 10
) -> list[dict]:
    """Return top matching iOS apps for a topic keyword."""
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


def _review_row(d: dict[str, Any], app_name: str, track_id: int) -> dict[str, Any]:
    # RSS entries are formatted with nested {"label": "..."} — flatten
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
        "sub": f"appstore:{app_name[:50]}",
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


def fetch_appstore_reviews(
    track_id: int,
    app_name: str = "",
    country: str = "us",
    pages: int = 10,
    max_reviews: int = 500,
) -> list[dict]:
    """Fetch up to ~500 reviews for an iOS app. Paginated via RSS feed."""
    rows: list[dict] = []
    for page in range(1, pages + 1):
        if len(rows) >= max_reviews:
            break
        url = _RSS.format(country=country, page=page, track_id=track_id)
        try:
            r = httpx.get(url, timeout=15)
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
            row = _review_row(e, app_name or f"app_{track_id}", track_id)
            if row["id"]:
                rows.append(row)
                if len(rows) >= max_reviews:
                    break
        # Extra breathing room — Apple's RSS throttle is aggressive
        time.sleep(2.0)
    return rows
