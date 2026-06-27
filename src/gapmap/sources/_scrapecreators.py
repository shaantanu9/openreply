"""Shared ScrapeCreators request helper for the TikTok / Instagram /
Threads / Pinterest adapters. One key powers all four; 100 free credits then
PAYG. Header auth is `x-api-key`.

The key is resolved from the in-app Reach Connections store first (where the
Connections UI saves a pasted key under source ``scrapecreators``), then falls
back to the SCRAPECREATORS_API_KEY env var for CLI / headless use.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx

BASE = "https://api.scrapecreators.com"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def api_key() -> str | None:
    # Reach Connections store wins over env so a key pasted in the UI works
    # without restarting the sidecar. Reads never raise.
    try:
        from ..core.credentials import api_key as _stored_key
        stored = _stored_key("scrapecreators")
        if stored:
            return stored
    except Exception:
        pass
    return os.getenv("SCRAPECREATORS_API_KEY") or None


def error_row(source: str) -> dict:
    return {"_error": f"SCRAPECREATORS_API_KEY not set — required for {source}. "
            "Get a key at scrapecreators.com (100 free credits, then pay-as-you-go)."}


def get(path: str, *, params: dict, timeout: float = 30.0) -> dict | None:
    """GET BASE+path with the key header. Returns parsed JSON, or None on
    any HTTP error (caller maps None -> []). Returns None if no key."""
    key = api_key()
    if not key:
        return None
    try:
        r = httpx.get(
            f"{BASE}{path}",
            params=params,
            headers={"x-api-key": key},
            timeout=timeout,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return None
    return r.json() or {}
