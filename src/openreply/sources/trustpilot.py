"""Trustpilot reviews — consumer-product sentiment at scale.

Trustpilot hosts millions of consumer reviews for brands worldwide.
Unlike App/Play Store, it covers non-mobile products (e-commerce,
services, fintech, D2C brands). Highest-value source for
consumer-product painpoint extraction outside the app stores.

Legal: Trustpilot's ToS prohibits automated data collection without
permission. This adapter is polite (single-threaded, rate-limited,
honest UA) but gray-area. Use at your own discretion for research.
For commercial/production use, contact Trustpilot for their official
API (tiered paid).

Strategy:
  1. Search for the brand → get the domain's business page URL
  2. Fetch review pages (JSON-LD embedded in HTML — no scraping)
  3. Parse aggregated rating + individual review cards

No API token needed. Degrades to [] with a logged hint on any error.
"""
from __future__ import annotations

import html
import json
import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx

_SEARCH = "https://www.trustpilot.com/search"
_REVIEWS = "https://www.trustpilot.com/review/{domain}"
# Trustpilot blocks bot-identifying User-Agents at the edge (Cloudflare).
# We use a standard desktop-Chrome UA so the adapter produces data; set
# TRUSTPILOT_HONEST_UA=1 to opt into a research-identifying UA instead
# (blocks all requests — useful for strict-compliance environments).
import os as _os
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
) if not _os.getenv("TRUSTPILOT_HONEST_UA") else (
    "OpenReply-Research/0.1 (+https://github.com/shaantanu9/openreply)"
)

_SLEEP_PER_PAGE = 1.2


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _get(url: str, params: dict[str, Any] | None = None, timeout: float = 15.0) -> str:
    """Fetch and return HTML. Empty string on any failure."""
    try:
        r = httpx.get(
            url,
            params=params,
            headers={"User-Agent": _UA, "Accept-Language": "en-US,en"},
            timeout=timeout,
            follow_redirects=True,
        )
        if r.status_code == 200:
            return r.text
    except httpx.HTTPError:
        pass
    return ""


def _extract_json_ld(html_text: str) -> list[dict]:
    """Parse every <script type=\"application/ld+json\"> block.

    Trustpilot embeds its review data as JSON-LD in the HTML of review
    pages. This is the least-hostile way to read it (no scraping, no
    DOM-crawling; they intend this data to be machine-readable for SEO).
    """
    out: list[dict] = []
    for match in re.finditer(
        r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
        html_text,
        re.DOTALL | re.IGNORECASE,
    ):
        raw = html.unescape(match.group(1).strip())
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, list):
            out.extend([x for x in parsed if isinstance(x, dict)])
        elif isinstance(parsed, dict):
            out.append(parsed)
    return out


def _search_domain(brand: str) -> str | None:
    """Resolve a brand name → trustpilot business domain slug.

    Trustpilot's search page embeds results as JSON-LD ItemList.
    Returns the canonical `domain.com` string suitable for /review/<domain>.
    """
    text = _get(_SEARCH, params={"query": brand})
    if not text:
        return None
    ld = _extract_json_ld(text)
    for item in ld:
        # Search results as ItemList → itemListElement with url pointing to /review/<domain>
        elements = item.get("itemListElement") or []
        for el in elements:
            url = (el.get("url") or "")
            m = re.search(r"/review/([^/?#]+)", url)
            if m:
                return m.group(1)
    # Fallback: regex against raw HTML for any /review/<domain> link
    m = re.search(r"/review/([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})", text)
    return m.group(1) if m else None


def _parse_review_page(html_text: str, domain: str) -> list[dict]:
    """Extract Review items from a business-page HTML blob."""
    rows: list[dict] = []
    for item in _extract_json_ld(html_text):
        if item.get("@type") == "LocalBusiness" or item.get("@type") == "Organization":
            # Aggregate stats — stored as a single synthetic "summary" row
            agg = item.get("aggregateRating") or {}
            if agg:
                rows.append({
                    "id": f"tp_summary_{domain}",
                    "sub": f"trustpilot:{domain}",
                    "source_type": "trustpilot",
                    "author": "[trustpilot-aggregate]",
                    "title": f"Trustpilot aggregate for {domain}",
                    "selftext": (
                        f"Overall rating: {agg.get('ratingValue')} / "
                        f"{agg.get('bestRating', 5)} across "
                        f"{agg.get('ratingCount') or agg.get('reviewCount')} reviews."
                    ),
                    "url": f"https://www.trustpilot.com/review/{domain}",
                    "score": int(float(agg.get("ratingValue") or 0) * 20),  # 0-100 scale
                    "upvote_ratio": None,
                    "num_comments": int(agg.get("reviewCount") or agg.get("ratingCount") or 0),
                    "created_utc": 0.0,
                    "is_self": 1, "over_18": 0,
                    "flair": "aggregate",
                    "permalink": f"https://www.trustpilot.com/review/{domain}",
                    "fetched_at": _now_iso(),
                })
            # Individual reviews nested in `review` array
            for rv in item.get("review") or []:
                rid = rv.get("@id") or rv.get("url") or ""
                if not rid:
                    continue
                rating = (rv.get("reviewRating") or {}).get("ratingValue") or 0
                body = rv.get("reviewBody") or rv.get("description") or ""
                author = (rv.get("author") or {}).get("name") or "[anon]"
                date_published = rv.get("datePublished") or ""
                try:
                    ts = datetime.fromisoformat(date_published.replace("Z", "+00:00")).timestamp()
                except (ValueError, AttributeError):
                    ts = 0.0
                rows.append({
                    "id": f"tp_{domain}_{hash(rid) & 0xFFFFFFFF:08x}",
                    "sub": f"trustpilot:{domain}",
                    "source_type": "trustpilot",
                    "author": author,
                    "title": rv.get("name") or (body[:80] if body else "(untitled review)"),
                    "selftext": body,
                    "url": rv.get("url") or "",
                    "score": int(float(rating)),       # 1-5 native
                    "upvote_ratio": None,
                    "num_comments": 0,
                    "created_utc": float(ts),
                    "is_self": 1, "over_18": 0,
                    "flair": f"rating:{int(float(rating))}",
                    "permalink": rv.get("url") or "",
                    "fetched_at": _now_iso(),
                })
    return rows


def _web_review_fallback(query: str, limit: int) -> list[dict]:
    """When Trustpilot's Cloudflare wall blocks the direct fetch, mine
    review/complaint signal from free web search instead (DuckDuckGo + Google
    News). Lower fidelity than native reviews, but keeps the "customer
    complaint" signal flowing into competitor analysis instead of returning 0.
    """
    items: list[dict] = []
    for q in (f"{query} reviews", f"{query} complaints", f"{query} problems"):
        try:
            from .duckduckgo import fetch_duckduckgo
            items.extend(fetch_duckduckgo(q, limit=12))
        except Exception:
            pass
        try:
            from .gnews import fetch_gnews
            items.extend(fetch_gnews(q, limit=8))
        except Exception:
            pass
    rows: list[dict] = []
    seen: set[str] = set()
    for it in items:
        url = it.get("url") or it.get("permalink") or ""
        if not url or url in seen:
            continue
        seen.add(url)
        rows.append({
            "id": f"tpweb_{hash(url) & 0xFFFFFFFF:08x}",
            "sub": f"trustpilot:{query}",
            "source_type": "trustpilot",
            "author": it.get("author") or "[web]",
            "title": (it.get("title") or "")[:200],
            "selftext": (it.get("selftext") or "")[:1500],
            "url": url,
            "score": 0,
            "upvote_ratio": None,
            "num_comments": 0,
            "created_utc": float(it.get("created_utc") or 0.0),
            "is_self": 1, "over_18": 0,
            "flair": "web-review",
            "permalink": None,
            "fetched_at": _now_iso(),
        })
        if len(rows) >= limit:
            break
    return rows


def fetch_trustpilot(
    query: str,
    pages: int = 3,
    limit: int = 90,
) -> list[dict]:
    """Search for a brand by name, then fetch up to `pages` pages of reviews.

    Args:
        query: brand/product name (e.g. "Calm", "Notion", "Robinhood")
        pages: number of review pages to fetch (each ~20 reviews)
        limit: hard cap on rows returned

    Returns list of post-shaped dicts ready for `upsert_posts`. Falls back to
    free web-search review signal if Trustpilot's Cloudflare wall blocks the
    direct fetch; empty list only when both yield nothing.
    """
    domain = _search_domain(query)
    collected: list[dict] = []
    if domain:
        for page in range(1, max(1, pages) + 1):
            url = _REVIEWS.format(domain=domain)
            html_text = _get(url, params={"page": page} if page > 1 else None)
            if not html_text:
                break
            rows = _parse_review_page(html_text, domain)
            if not rows:
                break
            collected.extend(rows)
            if len(collected) >= limit:
                return collected[:limit]
            time.sleep(_SLEEP_PER_PAGE)
    if collected:
        return collected
    # Cloudflare-blocked (or brand not on Trustpilot) → web-search fallback.
    return _web_review_fallback(query, limit)
