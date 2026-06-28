"""Truth Social search via its Mastodon-compatible API.

Requires TRUTHSOCIAL_TOKEN (bearer token copied from browser dev tools).
Without it, degrades gracefully to a single _error row. Ported from
last30days lib/truthsocial.py.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any

import httpx

_SEARCH_URL = "https://truthsocial.com/api/v2/search"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _token() -> str | None:
    # Reach Connections store (Connections UI saves the pasted bearer token
    # under source "truthsocial") wins over env. Reads never raise.
    try:
        from ..core.credentials import api_key as _stored_key
        stored = _stored_key("truthsocial")
        if stored:
            return stored
    except Exception:
        pass
    return os.getenv("TRUTHSOCIAL_TOKEN") or None


def _strip_html(html: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", html or "")
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


def _ts(created: str) -> float:
    try:
        return datetime.fromisoformat((created or "").replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return 0.0


def _row(s: dict[str, Any]) -> dict[str, Any]:
    acct = s.get("account") or {}
    handle = acct.get("acct") or acct.get("username") or "[anon]"
    text = _strip_html(s.get("content") or "")
    return {
        "id": f"ts_{s.get('id')}",
        "sub": "truthsocial",
        "source_type": "truthsocial",
        "author": handle,
        "title": text[:200] or f"Truth by {handle}",
        "selftext": text,
        "url": s.get("url") or "",
        "score": int(s.get("favourites_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(s.get("replies_count") or 0),
        "created_utc": _ts(s.get("created_at") or ""),
        "is_self": 1,
        "over_18": 0,
        "flair": f"reblogs={int(s.get('reblogs_count') or 0)}",
        "permalink": s.get("url") or "",
        "fetched_at": _now_iso(),
    }


def fetch_truthsocial(query: str, limit: int = 30) -> list[dict]:
    tok = _token()
    if not tok:
        return [{"_error": "TRUTHSOCIAL_TOKEN not set — copy the bearer token from "
                 "truthsocial.com browser dev tools (Network tab)"}]
    try:
        r = httpx.get(
            _SEARCH_URL,
            params={"q": query, "type": "statuses", "limit": str(min(40, limit))},
            headers={"Authorization": f"Bearer {tok}"},
            timeout=30,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    statuses = ((r.json() or {}).get("statuses")) or []
    return [_row(s) for s in statuses[:limit]]
