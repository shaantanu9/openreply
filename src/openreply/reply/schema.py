"""OpenReply SQLite schema — brands, opportunities, drafts, and a subreddit-rule
cache. Lives in the same `openreply.db` as everything else (one shared store), so it
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
                # created_utc = the source post/article's own timestamp (epoch
                # seconds) so the UI can show how old the conversation is.
                "created_utc": int,
            },
            pk="id",
        )
        db["reply_opportunities"].create_index(["brand_id", "status"])
        db["reply_opportunities"].create_index(["score"])
        # lifecycle columns present from the start on fresh tables
        for _c in ("snooze_until", "updated_at", "scheduled_at", "posted_at"):
            db["reply_opportunities"].add_column(_c, int)
    else:
        # forward-compat: add the engagement-RRF score columns to older tables
        existing = {c.name for c in db["reply_opportunities"].columns}
        for col in ("engagement", "freshness", "rrf"):
            if col not in existing:
                db["reply_opportunities"].add_column(col, float)
        # lifecycle columns: snooze (snoozed status), updated_at (sort by recent),
        # scheduled_at (queued), posted_at (posted). All nullable int epochs.
        for col in ("snooze_until", "updated_at", "scheduled_at", "posted_at", "created_utc"):
            if col not in existing:
                db["reply_opportunities"].add_column(col, int)

    if "reply_drafts" not in names:
        db["reply_drafts"].create(
            {
                "id": str, "opportunity_id": str, "brand_id": str, "platform": str,
                "text": str, "compliant": int, "compliance_notes": str,
                "version": int, "source": str, "created_at": int, "updated_at": int,
            },
            pk="id",
        )
        db["reply_drafts"].create_index(["opportunity_id", "version"])
    else:
        # forward-compat: versioning columns on older draft tables.
        _dexisting = {c.name for c in db["reply_drafts"].columns}
        if "version" not in _dexisting:
            db["reply_drafts"].add_column("version", int)
        if "source" not in _dexisting:
            db["reply_drafts"].add_column("source", str)
        if "updated_at" not in _dexisting:
            db["reply_drafts"].add_column("updated_at", int)

    if "reply_sub_rules" not in names:
        db["reply_sub_rules"].create(
            {"sub": str, "rules_json": str, "summary": str, "fetched_at": int},
            pk="sub",
        )

    if "reply_feedback" not in names:
        # Lifecycle signal fed back into learning: `engaged` (saved/replied — a
        # post worth learning from) or `dismissed` (skipped — suppress from
        # future opportunity lists). One row per opportunity (latest signal wins).
        db["reply_feedback"].create(
            {
                "opportunity_id": str, "agent_id": str, "post_id": str,
                "platform": str, "signal": str, "title": str, "excerpt": str,
                "created_at": int,
            },
            pk="opportunity_id",
        )
        db["reply_feedback"].create_index(["agent_id", "signal"])

    if "reply_playbook" not in names:
        # Versioned Goal Playbook — the agent's self-evolving promotion strategy.
        db["reply_playbook"].create(
            {
                "id": str, "agent_id": str, "version": int,
                "playbook_json": str, "sources_json": str, "summary": str,
                "created_at": int,
            },
            pk="id",
        )
        db["reply_playbook"].create_index(["agent_id", "version"])

    if "reply_ideas" not in names:
        # Synthesized content ideas (fused from memories + beliefs across sources).
        db["reply_ideas"].create(
            {
                "id": str, "agent_id": str, "title": str, "thesis": str,
                "kind": str, "combines_json": str, "source_mix": str,
                "goal_fit": float, "status": str, "created_at": int,
            },
            pk="id",
        )
        db["reply_ideas"].create_index(["agent_id", "status"])

    return db
