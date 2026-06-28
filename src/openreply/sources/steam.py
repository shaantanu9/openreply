"""Steam — real user REVIEWS for games + software sold on Steam. Free public
API, no key. Two-step: storesearch (term → appid) → appreviews (appid →
reviews). Game/creative-software focused; returns [] for non-Steam topics
(harmless — the collect pipeline isolates each source).

https://partner.steamgames.com/doc/store/getreviews
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

_SEARCH = "https://store.steampowered.com/api/storesearch/"
_REVIEWS = "https://store.steampowered.com/appreviews/{appid}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _resolve_apps(term: str, max_apps: int = 3) -> list[tuple[int, str]]:
    try:
        r = httpx.get(_SEARCH, params={"term": term, "cc": "us", "l": "en"}, timeout=15)
        r.raise_for_status()
        items = (r.json() or {}).get("items") or []
    except httpx.HTTPError:
        return []
    out: list[tuple[int, str]] = []
    for i in items[:max_apps]:
        if i.get("id"):
            out.append((int(i["id"]), str(i.get("name") or "")))
    return out


def _review_row(rev: dict[str, Any], appid: int, appname: str) -> dict[str, Any]:
    a = rev.get("author") or {}
    steamid = a.get("steamid")
    url = (
        f"https://steamcommunity.com/profiles/{steamid}/recommended/{appid}/"
        if steamid else f"https://store.steampowered.com/app/{appid}/"
    )
    return {
        "id": f"steam_{rev.get('recommendationid')}",
        "sub": (f"steam:{appname}" if appname else "steam")[:60],
        "source_type": "steam",
        "author": str(steamid or "[steam user]"),
        "title": "",
        "selftext": (rev.get("review") or "")[:4000],
        "url": url,
        "score": int(rev.get("votes_up") or 0),
        "upvote_ratio": None,
        "num_comments": int(rev.get("comment_count") or 0),
        "created_utc": float(rev.get("timestamp_created") or 0),
        "is_self": 1,
        "over_18": 0,
        "flair": "recommended" if rev.get("voted_up") else "not recommended",
        "permalink": None,
        "fetched_at": _now_iso(),
    }


def fetch_steam(query: str, limit: int = 30) -> list[dict]:
    apps = _resolve_apps(query)
    if not apps:
        return []
    out: list[dict] = []
    per_app = max(5, limit // len(apps))
    for appid, name in apps:
        try:
            r = httpx.get(
                _REVIEWS.format(appid=appid),
                params={
                    "json": 1, "filter": "recent", "language": "english",
                    "num_per_page": min(100, per_app), "purchase_type": "all",
                    "review_type": "all",
                },
                timeout=15,
            )
            r.raise_for_status()
            revs = (r.json() or {}).get("reviews") or []
        except httpx.HTTPError:
            continue
        out.extend(_review_row(x, appid, name) for x in revs)
        if len(out) >= limit:
            break
    return out[:limit]
