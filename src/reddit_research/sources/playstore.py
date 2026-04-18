"""Google Play reviews + app search via the google-play-scraper pkg.

Install:  pip install -e ".[sources]"
The pkg is pure Python, no auth.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _require_gps():
    try:
        import google_play_scraper as gps  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "Install the sources extra: pip install -e '.[sources]'"
        ) from e
    return gps


def search_playstore_apps(topic: str, country: str = "us", lang: str = "en", limit: int = 10) -> list[dict]:
    """Return top-N Play Store apps matching a topic."""
    gps = _require_gps()
    try:
        hits = gps.search(topic, country=country, lang=lang, n_hits=limit)
    except Exception:
        return []
    return [
        {
            "app_id": a.get("appId"),
            "name": a.get("title"),
            "developer": a.get("developer"),
            "score": a.get("score"),
            "price": a.get("price"),
            "free": a.get("free"),
            "installs": a.get("installs"),
            "url": a.get("url"),
            "description": a.get("description") or "",
        }
        for a in hits
    ]


def _review_row(d: dict[str, Any], app_id: str) -> dict[str, Any]:
    rid = d.get("reviewId")
    when = d.get("at")  # datetime
    try:
        ts = float(when.timestamp()) if when else 0.0
    except AttributeError:
        ts = 0.0
    return {
        "id": f"playstore_{rid}",
        "sub": f"playstore:{app_id}",
        "source_type": "playstore",
        "author": d.get("userName") or "[anon]",
        "title": "",
        "selftext": d.get("content") or "",
        "url": f"https://play.google.com/store/apps/details?id={app_id}",
        "score": int(d.get("score") or 0),
        "upvote_ratio": None,
        "num_comments": int(d.get("thumbsUpCount") or 0),  # repurpose for helpful-count
        "created_utc": ts,
        "is_self": 1,
        "over_18": 0,
        "flair": f"★{d.get('score')}",
        "permalink": f"https://play.google.com/store/apps/details?id={app_id}",
        "fetched_at": _now_iso(),
    }


def fetch_playstore_reviews(
    app_id: str,
    country: str = "us",
    lang: str = "en",
    count: int = 200,
    sort: str = "newest",  # newest | rating | helpfulness
) -> list[dict]:
    gps = _require_gps()
    sort_map = {
        "newest": gps.Sort.NEWEST,
        "rating": gps.Sort.RATING,
        "helpfulness": gps.Sort.MOST_RELEVANT,
    }
    try:
        result, _ = gps.reviews(
            app_id,
            lang=lang, country=country,
            sort=sort_map.get(sort, gps.Sort.NEWEST),
            count=count,
        )
    except Exception:
        return []
    return [_review_row(d, app_id) for d in (result or [])]
