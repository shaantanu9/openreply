"""Exa — neural web search via the Exa REST API. Key-gated (free tier).

Exa (exa.ai) is a semantic/neural search engine. We call its REST API directly
(`POST /search` with `x-api-key`) rather than agent-reach's mcporter path, so it
bundles into the sidecar with no node dependency. The key comes from the
`EXA_API_KEY` env var or the stored credential (Reach Connections → Exa card).
No key → [] (degrades gracefully). Never raises.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx

from ..core import credentials as _creds
from ._http import USER_AGENT

_SEARCH = "https://api.exa.ai/search"
_TIMEOUT = 20.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _resolve_key() -> str:
    return os.environ.get("EXA_API_KEY") or _creds.api_key("exa_search") or ""


def _post_json(url: str, key: str, body: dict) -> dict:
    headers = {"x-api-key": key, "User-Agent": USER_AGENT, "Content-Type": "application/json"}
    with httpx.Client(timeout=_TIMEOUT) as c:
        r = c.post(url, headers=headers, json=body)
        r.raise_for_status()
        return r.json()


def _epoch(date_str: str | None) -> float:
    if not date_str:
        return 0.0
    try:
        return datetime.fromisoformat(date_str.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _row(it: dict) -> dict:
    url = it.get("url") or ""
    return {
        "id": f"exa_{hash(it.get('id') or url) & 0xFFFFFFFF:x}",
        "sub": "exa",
        "source_type": "exa",
        "author": it.get("author") or "",
        "title": (it.get("title") or url)[:300],
        "selftext": (it.get("text") or "")[:2000],
        "url": url,
        "score": 0,
        "upvote_ratio": None,
        "num_comments": 0,
        "created_utc": _epoch(it.get("publishedDate")),
        "is_self": 0,
        "over_18": 0,
        "flair": None,
        "permalink": None,
        "fetched_at": _now_iso(),
    }


def fetch_exa_search(query: str, limit: int = 30, **_) -> list[dict]:
    """Neural web search via Exa → posts rows. [] when no key. Never raises."""
    q = (query or "").strip()
    if not q:
        return []
    key = _resolve_key()
    if not key:
        return []
    body = {"query": q, "numResults": int(limit), "contents": {"text": True}}
    try:
        data = _post_json(_SEARCH, key, body)
    except Exception:
        return []
    results = (data or {}).get("results") or []
    return [_row(it) for it in results[:limit]]
