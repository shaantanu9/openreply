"""Brand / persona profile — the identity and voice OpenReply writes in.

Single-brand for now (id="default"); the schema already supports multiple rows
keyed by id, so multi-brand is a later, additive change.
"""
from __future__ import annotations

import json
import time

from .schema import init_reply_schema

_BRAND_ID = "default"


def get_brand() -> dict | None:
    db = init_reply_schema()
    try:
        row = dict(db["reply_brands"].get(_BRAND_ID))
    except Exception:
        return None
    row["keywords"] = json.loads(row.get("keywords_json") or "[]")
    row["platforms"] = json.loads(row.get("platforms_json") or "[]")
    return row


def set_brand(
    *,
    name: str | None = None,
    url: str | None = None,
    description: str | None = None,
    keywords: list[str] | None = None,
    persona: str | None = None,
    tone: str | None = None,
    platforms: list[str] | None = None,
) -> dict:
    """Upsert the brand profile, merging with any existing values."""
    db = init_reply_schema()
    cur = get_brand() or {}
    now = int(time.time())

    def pick(new, key, default=""):
        return new if new is not None else cur.get(key, default)

    rec = {
        "id": _BRAND_ID,
        "name": pick(name, "name"),
        "url": pick(url, "url"),
        "description": pick(description, "description"),
        "keywords_json": json.dumps(keywords if keywords is not None else cur.get("keywords", [])),
        "persona": pick(persona, "persona"),
        "tone": pick(tone, "tone", "helpful, concise, non-salesy"),
        "platforms_json": json.dumps(
            platforms if platforms is not None else cur.get("platforms", ["reddit_free"])
        ),
        "created_at": cur.get("created_at", now),
        "updated_at": now,
    }
    db["reply_brands"].upsert(rec, pk="id")
    return get_brand()
