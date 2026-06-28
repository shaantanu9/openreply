"""AlternativeTo.net — "what's the alternative to X" signal.

⚠ AlternativeTo front-ends their internal API behind Cloudflare bot protection
(returns 403 challenge to unauth clients as of 2026). This adapter degrades
to empty on failure. If you need the data, manual export or a
proxy-rotating scraper would be required.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

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


def fetch_alternativeto(product: str, limit: int = 20) -> list[dict]:
    """List alternatives to a named product. Returns [] if product not found."""
    # 1. Search for the product slug
    try:
        r = httpx.get(_SEARCH, params={"q": product, "take": 5}, timeout=15)
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    data = r.json() or {}
    software = data.get("software") or data.get("items") or []
    if not software:
        return []
    slug = software[0].get("urlName") or software[0].get("slug")
    if not slug:
        return []
    # 2. Fetch alternatives
    try:
        r = httpx.get(_ALTS.format(slug=slug), params={"take": min(50, limit)}, timeout=15)
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    alts_data = r.json() or {}
    alts = alts_data.get("alternatives") or alts_data.get("items") or []
    product_name = software[0].get("name") or product
    return [_row(a, for_product=product_name) for a in alts[:limit]]
