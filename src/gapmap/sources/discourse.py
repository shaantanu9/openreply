"""Discourse forum search. Many product communities run Discourse (Obsidian,
Logseq, Figma, Notion, Zettelkasten, etc.) and most expose their data via
`.json` on standard paths.

Examples:
  https://forum.obsidian.md/search.json?q=...
  https://forum.logseq.com/search.json?q=...
  https://discuss.huggingface.co/search.json?q=...

No auth needed for public forums. Per-instance config via the `instance` arg.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(t: dict[str, Any], instance: str) -> dict[str, Any]:
    try:
        ts = datetime.fromisoformat((t.get("created_at") or "").replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        ts = 0.0
    tid = t.get("id")
    slug = t.get("slug") or "topic"
    return {
        "id": f"discourse_{instance}_{tid}",
        "sub": f"discourse:{instance}",
        "source_type": "discourse",
        "author": t.get("last_poster_username") or t.get("username") or "[anon]",
        "title": (t.get("title") or "")[:300],
        "selftext": "",
        "url": f"https://{instance}/t/{slug}/{tid}",
        "score": int(t.get("like_count") or 0),
        "upvote_ratio": None,
        "num_comments": int(t.get("posts_count") or 0),
        "created_utc": float(ts),
        "is_self": 1,
        "over_18": 0,
        "flair": ",".join(t.get("tags") or [])[:80] if t.get("tags") else None,
        "permalink": f"https://{instance}/t/{slug}/{tid}",
        "fetched_at": _now_iso(),
    }


def fetch_discourse(query: str, instance: str, limit: int = 30) -> list[dict]:
    """Search a Discourse forum instance (e.g. 'forum.obsidian.md')."""
    try:
        r = httpx.get(
            f"https://{instance}/search.json",
            params={"q": query},
            headers={"User-Agent": "gapmap/0.1"},
            timeout=20,
        )
        r.raise_for_status()
    except httpx.HTTPError:
        return []
    data = r.json() or {}
    topics = data.get("topics") or []
    return [_row(t, instance) for t in topics[:limit]]
