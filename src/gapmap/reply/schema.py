"""OpenReply SQLite schema — brands, opportunities, drafts, and a subreddit-rule
cache. Lives in the same `gapmap.db` as everything else (one shared store), so it
reuses WAL mode and the thread-local connection from `core.db`.
"""
from __future__ import annotations

from sqlite_utils import Database

from ..core.db import get_db


def init_reply_schema(db: Database | None = None) -> Database:
    """Create the reply_* tables if absent. Idempotent; safe to call every op."""
    db = db or get_db()
    names = set(db.table_names())

    if "reply_brands" not in names:
        db["reply_brands"].create(
            {
                "id": str, "name": str, "url": str, "description": str,
                "keywords_json": str, "persona": str, "tone": str,
                "platforms_json": str, "created_at": int, "updated_at": int,
            },
            pk="id",
        )

    if "reply_opportunities" not in names:
        db["reply_opportunities"].create(
            {
                "id": str, "brand_id": str, "platform": str, "post_id": str,
                "title": str, "body": str, "url": str, "author": str, "sub": str,
                "score": float, "relevance": float, "intent": float, "fit": float,
                "engagement": float, "freshness": float, "rrf": float,
                "reason": str, "status": str, "found_at": int,
            },
            pk="id",
        )
        db["reply_opportunities"].create_index(["brand_id", "status"])
        db["reply_opportunities"].create_index(["score"])
    else:
        # forward-compat: add the engagement-RRF score columns to older tables
        existing = {c.name for c in db["reply_opportunities"].columns}
        for col in ("engagement", "freshness", "rrf"):
            if col not in existing:
                db["reply_opportunities"].add_column(col, float)

    if "reply_drafts" not in names:
        db["reply_drafts"].create(
            {
                "id": str, "opportunity_id": str, "brand_id": str, "platform": str,
                "text": str, "compliant": int, "compliance_notes": str, "created_at": int,
            },
            pk="id",
        )

    if "reply_sub_rules" not in names:
        db["reply_sub_rules"].create(
            {"sub": str, "rules_json": str, "summary": str, "fetched_at": int},
            pk="sub",
        )

    return db
