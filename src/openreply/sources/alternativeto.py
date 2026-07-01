"""AlternativeTo-style "what's the alternative to X" competitor signal.

AlternativeTo.net front-ends its internal API behind Cloudflare bot protection
(403 challenge to unauth clients as of 2026), so the official API is unreliable.
This adapter therefore discovers alternatives/competitors the *proper* free way —
porting the last30days-skill `competitors.py` approach: run "X alternatives /
competitors / vs" web searches (via our already-working DuckDuckGo + Google News
fetchers) and deterministically mine brand-shaped peer entities from the result
titles + snippets. No API key, no Cloudflare block.

The Cloudflare-gated API is still attempted first (short timeout) in case it's
reachable from the caller's IP; on 403/failure we fall back to web discovery.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from ._peer_entities import extract_peer_entities

_SEARCH = "https://alternativeto.net/api/search/"
_ALTS = "https://alternativeto.net/api/software/{slug}/alternatives/"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(s: dict[str, Any], for_product: str | None = None) -> dict[str, Any]:
    slug = s.get("urlName") or s.get("slug") or ""
    name = s.get("name") or ""
    desc = s.get("shortDescription") or s.get("description") or ""
    likes = int(s.get("likes") or s.get("likeCount") or 0)
    return {
        "id": f"alt2_{slug}",
        "sub": f"alt2:{for_product}" if for_product else "alt2",
        "source_type": "alternativeto",
        "author": s.get("creator") or "[community]",
        "title": f"{name} — alternative to {for_product}" if for_product else name,
        "selftext": desc[:1500],
        "url": f"https://alternativeto.net/software/{slug}/" if slug else "",
        "score": likes,
        "upvote_ratio": None,
        "num_comments": 0,
        "created_utc": 0.0,
        "is_self": 1,
        "over_18": 0,
        "flair": ",".join(s.get("platforms") or [])[:80] if s.get("platforms") else None,
        "permalink": f"https://alternativeto.net/software/{slug}/" if slug else None,
        "fetched_at": _now_iso(),
    }


def _entity_row(name: str, for_product: str, rank: int) -> dict[str, Any]:
    """Post-shaped row for a web-discovered peer entity."""
    slug = name.lower().replace(" ", "-")
    return {
        "id": f"alt2web_{for_product.lower().replace(' ', '-')}_{slug}",
        "sub": f"alt2:{for_product}",
        "source_type": "alternativeto",
        "author": "[web-discovery]",
        "title": f"{name} — alternative/competitor to {for_product}",
        "selftext": f"{name} surfaced as a peer/alternative to {for_product} across "
                    f"web search results (\"{for_product} alternatives / competitors / vs\").",
        "url": "",
        "score": max(0, 100 - rank * 5),  # rank-decayed relevance score
        "upvote_ratio": None,
        "num_comments": 0,
        "created_utc": 0.0,
        "is_self": 1,
        "over_18": 0,
        "flair": "web-discovery",
        "permalink": None,
        "fetched_at": _now_iso(),
    }


def _api_alternatives(product: str, limit: int) -> list[dict]:
    """Best-effort AlternativeTo API. Returns [] on Cloudflare 403 / any failure."""
    try:
        r = httpx.get(_SEARCH, params={"q": product, "take": 5}, timeout=8)
        r.raise_for_status()
        data = r.json() or {}
    except (httpx.HTTPError, ValueError):
        return []
    software = data.get("software") or data.get("items") or []
    if not software:
        return []
    slug = software[0].get("urlName") or software[0].get("slug")
    if not slug:
        return []
    try:
        r = httpx.get(_ALTS.format(slug=slug), params={"take": min(50, limit)}, timeout=8)
        r.raise_for_status()
        alts_data = r.json() or {}
    except (httpx.HTTPError, ValueError):
        return []
    alts = alts_data.get("alternatives") or alts_data.get("items") or []
    product_name = software[0].get("name") or product
    return [_row(a, for_product=product_name) for a in alts[:limit]]


def _web_discovered_alternatives(product: str, limit: int) -> list[dict]:
    """Discover peers via free web search + deterministic entity extraction."""
    items: list[dict] = []
    for q in (f"{product} alternatives", f"{product} competitors", f"{product} vs"):
        try:
            from .duckduckgo import fetch_duckduckgo
            items.extend(fetch_duckduckgo(q, limit=15))
        except Exception:
            pass
        try:
            from .gnews import fetch_gnews
            items.extend(fetch_gnews(q, limit=10))
        except Exception:
            pass
    if not items:
        return []
    names = extract_peer_entities(items, product, limit=limit)
    return [_entity_row(n, product, i) for i, n in enumerate(names)]


def fetch_alternativeto(product: str, limit: int = 20) -> list[dict]:
    """List alternatives/competitors to a named product.

    Tries the AlternativeTo API first (usually Cloudflare-blocked), then falls
    back to free web-search discovery. Returns [] only if both yield nothing.
    """
    rows = _api_alternatives(product, limit)
    if rows:
        return rows
    return _web_discovered_alternatives(product, limit)
