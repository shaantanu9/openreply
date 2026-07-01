"""Competitor registry — CRUD over the product_competitors table."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from ...core.db import get_db

# Competitor sweep default sources. Chosen so a sweep reliably pulls from MANY
# databases even when the credential-gated / Cloudflare-flaky review sites return
# nothing. Split into two tiers:
#   • Customer-feedback tier (highest signal when they work): app/play reviews,
#     Trustpilot web reviews, Product Hunt launch reactions.
#   • Fast-free-reliable tier (always returns something): HN, Reddit, Stack
#     Overflow Q&A, Dev.to, Google News, DuckDuckGo web, and product/listing RSS.
# NOTE: use the canonical adapter ids from sources.collect_adapter.SOURCES.
#   - "hn" (NOT "hackernews" — though an alias now covers that too)
#   - "alternativeto" is intentionally NOT default: Cloudflare bot-blocks unauth
#     clients so it returns 0. Still available opt-in per-competitor.
#   - "producthunt" needs PH_TOKEN; it degrades to 0 cleanly when unset.
DEFAULT_SOURCE_PACK: list[str] = [
    # customer-feedback tier
    "appstore", "playstore", "trustpilot", "producthunt",
    # fast-free-reliable tier
    "hn", "reddit_free", "stackoverflow", "devto",
    "gnews", "duckduckgo", "rss_products", "rss_listings",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(name: str) -> str:
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def competitor_topic(slug: str) -> str:
    return f"competitor:{slug}"


def _row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
    def _j(v, default):
        if not v:
            return default
        try:
            return json.loads(v)
        except Exception:
            return default
    urls_val = _j(row.get("urls_json"), {})
    return {
        "product_id": row.get("product_id"),
        "competitor_name": row.get("competitor_name"),
        "slug": row.get("slug"),
        "topic": row.get("topic"),
        "website": (urls_val or {}).get("website", ""),
        "urls": urls_val,
        "aliases": _j(row.get("aliases_json"), []),
        "subreddits": _j(row.get("subreddits_json"), []),
        "source_config": _j(row.get("source_config_json"), {}),
        "category": row.get("category") or "",
        "status": row.get("status") or "active",
        "daily_fetch": bool(row.get("daily_fetch")),
        "in_opp_scan": bool(row.get("in_opp_scan")),
        "notes": row.get("notes") or "",
        "is_active": bool(row.get("is_active", 1)),
        "tracked_since": row.get("tracked_since"),
        "updated_at": row.get("updated_at"),
    }


def add_competitor(
    product_id: str,
    name: str,
    *,
    website: str = "",
    urls: dict | None = None,
    aliases: list[str] | None = None,
    subreddits: list[str] | None = None,
    source_config: dict | None = None,
    category: str = "",
    daily_fetch: bool = False,
    in_opp_scan: bool = True,
    notes: str = "",
) -> dict[str, Any]:
    db = get_db()
    slug = _slugify(name)
    url_map = dict(urls or {})
    if website:
        url_map.setdefault("website", website)
    cfg = source_config or {"enabled_adapters": list(DEFAULT_SOURCE_PACK), "params": {}}

    # Preserve tracked_since on re-add (upsert)
    existing = get_competitor(product_id, name)
    tracked_since = existing["tracked_since"] if existing else _now()

    rec = {
        "product_id": product_id,
        "competitor_name": name,
        "slug": slug,
        "topic": competitor_topic(slug),
        "urls_json": json.dumps(url_map),
        "aliases_json": json.dumps(aliases or []),
        "subreddits_json": json.dumps(subreddits or []),
        "source_config_json": json.dumps(cfg),
        "category": category,
        "status": "active",
        "daily_fetch": 1 if daily_fetch else 0,
        "in_opp_scan": 1 if in_opp_scan else 0,
        "notes": notes,
        "is_active": 1,
        "tracked_since": tracked_since,
        "updated_at": _now(),
    }
    db["product_competitors"].upsert(rec, pk=("product_id", "competitor_name"))
    return get_competitor(product_id, name)  # type: ignore[return-value]


def get_competitor(product_id: str, name: str) -> dict[str, Any] | None:
    db = get_db()
    rows = list(
        db["product_competitors"].rows_where(
            "product_id = ? and competitor_name = ?", [product_id, name]
        )
    )
    return _row_to_dict(rows[0]) if rows else None


def list_competitors(
    product_id: str | None = None, active_only: bool = False
) -> list[dict[str, Any]]:
    db = get_db()
    where, params = [], []
    if product_id:
        where.append("product_id = ?")
        params.append(product_id)
    if active_only:
        where.append("is_active = 1")
    clause = " and ".join(where) if where else None
    rows = (
        db["product_competitors"].rows_where(clause, params)
        if clause
        else db["product_competitors"].rows
    )
    return [_row_to_dict(r) for r in rows]


_JSON_FIELDS = {"urls": "urls_json", "aliases": "aliases_json",
                "subreddits": "subreddits_json", "source_config": "source_config_json"}
_BOOL_FIELDS = {"daily_fetch", "in_opp_scan", "is_active"}
_PLAIN_FIELDS = {"category", "status", "notes"}


def update_competitor(product_id: str, name: str, **fields: Any) -> dict[str, Any] | None:
    db = get_db()
    cur = get_competitor(product_id, name)
    if not cur:
        return None
    patch: dict[str, Any] = {"updated_at": _now()}
    for k, v in fields.items():
        if k == "website":
            urls = dict(cur["urls"]) if cur else {}
            urls["website"] = v
            patch["urls_json"] = json.dumps(urls)
        elif k in _JSON_FIELDS:
            patch[_JSON_FIELDS[k]] = json.dumps(v)
        elif k in _BOOL_FIELDS:
            patch[k] = 1 if v else 0
        elif k in _PLAIN_FIELDS:
            patch[k] = v
    db["product_competitors"].update((product_id, name), patch)
    return get_competitor(product_id, name)


def remove_competitor(product_id: str, name: str) -> bool:
    db = get_db()
    if not get_competitor(product_id, name):
        return False
    db["product_competitors"].delete((product_id, name))
    return True
