"""Polymarket prediction-market search via the public Gamma API.

No API key required (public read-only, generous rate limits). Behavior
ported from last30days lib/polymarket.py: search events, render the Yes/No
outcome odds as percentages, use market volume as the engagement score.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import httpx

_GAMMA_SEARCH = "https://gamma-api.polymarket.com/public-search"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _odds_text(markets: list[dict]) -> str:
    """Render 'Yes 74% · No 26%' from the first market's outcome prices.
    Both `outcomes` and `outcomePrices` arrive as JSON-encoded strings."""
    if not markets:
        return ""
    m = markets[0]
    try:
        outs = m.get("outcomes")
        prices = m.get("outcomePrices")
        outs = json.loads(outs) if isinstance(outs, str) else (outs or [])
        prices = json.loads(prices) if isinstance(prices, str) else (prices or [])
    except (ValueError, TypeError):
        return ""
    parts = []
    for name, price in zip(outs, prices):
        try:
            pct = round(float(price) * 100)
        except (ValueError, TypeError):
            continue
        parts.append(f"{name} {pct}%")
    return " · ".join(parts)


def _row(ev: dict[str, Any]) -> dict[str, Any]:
    markets = ev.get("markets") or []
    slug = ev.get("slug") or ""
    vol = ev.get("volume") or (markets[0].get("volume") if markets else 0) or 0
    return {
        "id": f"pm_{slug or ev.get('id') or ev.get('title','')[:40]}",
        "sub": "polymarket",
        "source_type": "polymarket",
        "author": "[market]",
        "title": (ev.get("title") or "")[:200],
        "selftext": _odds_text(markets),
        "url": f"https://polymarket.com/event/{slug}" if slug else "",
        "score": int(vol or 0),
        "upvote_ratio": None,
        "num_comments": 0,
        "created_utc": 0.0,
        "is_self": 1,
        "over_18": 0,
        "flair": "prediction-market",
        "permalink": f"https://polymarket.com/event/{slug}" if slug else "",
        "fetched_at": _now_iso(),
    }


def fetch_polymarket(query: str, limit: int = 20) -> list[dict]:
    try:
        r = httpx.get(
            _GAMMA_SEARCH,
            params={"q": query, "limit_per_type": min(50, limit)},
            timeout=20,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    events = ((r.json() or {}).get("events")) or []
    return [_row(e) for e in events[:limit]]
