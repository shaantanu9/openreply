"""Scheduled content poster + reminder for queued Compose drafts.

A content item reaches `scheduled` (with a `scheduled_at` epoch) via
`content.update_content(..., status='scheduled', scheduled_at=...)`. This module
processes the ones whose schedule has arrived: it tries a **best-effort auto-post**
where a write-capable publisher exists (X, LinkedIn), and otherwise surfaces a
Telegram reminder with action buttons so the user can copy/mark-posted/regenerate.

Reminders are deduped per content id so a still-scheduled item doesn't re-ping on
every scheduler tick.
"""
from __future__ import annotations

import time
import uuid

from .schema import init_reply_schema


def _active_brand_id() -> str:
    from .agent import active_id
    return active_id() or "default"


def due_content_items(now: int | None = None) -> list[dict]:
    """Scheduled content items whose `scheduled_at` has arrived."""
    now = now or int(time.time())
    db = init_reply_schema()
    try:
        rows = db["content_items"].rows_where(
            "status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?",
            [now],
            order_by="scheduled_at asc",
        )
    except Exception:
        return []
    return [dict(r) for r in rows]


def _ensure_publish_log(db):
    """Idempotent content_publish_log table."""
    if "content_publish_log" not in set(db.table_names()):
        db["content_publish_log"].create(
            {
                "id": str, "content_id": str, "platform": str,
                "attempted_at": int, "status": str, "remote_id": str,
                "remote_url": str, "error": str, "metrics_json": str,
            },
            pk="id",
        )
        db["content_publish_log"].create_index(["content_id"])
    return db


def _already_posted(db, content_id: str, platform: str) -> bool:
    """Idempotency guard: one successful post per (content, platform)."""
    try:
        rows = list(db["content_publish_log"].rows_where(
            "content_id = ? AND platform = ? AND status = 'ok'",
            [content_id, platform], limit=1,
        ))
        return bool(rows)
    except Exception:
        return False


def _log_attempt(db, content_id: str, platform: str, status: str,
                 remote_id: str = "", remote_url: str = "", error: str = "") -> None:
    _ensure_publish_log(db)
    db["content_publish_log"].insert(
        {
            "id": uuid.uuid4().hex,
            "content_id": content_id,
            "platform": platform,
            "attempted_at": int(time.time()),
            "status": status,
            "remote_id": remote_id,
            "remote_url": remote_url,
            "error": error,
            "metrics_json": "",
        },
        pk="id",
    )


def _publisher_for(platform: str):
    """Return the publisher module for a platform key, or None."""
    p = (platform or "").lower()
    if p in ("x", "twitter"):
        from ..publish import x
        return x
    if p == "linkedin":
        from ..publish import linkedin
        return linkedin
    return None


def autopost_item(item: dict, platform: str | None = None) -> dict:
    """Try to publish a content item to one platform.

    Returns {"ok": bool, "remote_url": str, "error": str, "platform": str}.
    """
    platform = platform or item.get("platform") or ""
    body = (item.get("body") or "").strip()
    if not body:
        return {"ok": False, "platform": platform, "error": "empty content"}

    pub = _publisher_for(platform)
    if not pub:
        return {"ok": False, "platform": platform, "error": f"no publisher for {platform}"}

    db = init_reply_schema()
    if _already_posted(db, item["id"], platform):
        return {"ok": True, "platform": platform, "remote_url": "", "error": "", "note": "already posted"}

    res = pub.publish(body, dry_run=False)
    out = {
        "ok": res.ok,
        "platform": platform,
        "remote_url": res.url,
        "remote_id": res.ids[0] if res.ids else "",
        "error": res.error,
    }

    db = init_reply_schema()
    now = int(time.time())
    if res.ok:
        try:
            db["content_items"].update(
                item["id"],
                {"status": "posted", "posted_at": now,
                 "remote_url": res.url, "updated_at": now},
            )
        except Exception:
            pass
        _log_attempt(db, item["id"], platform, "ok",
                     remote_id=out["remote_id"], remote_url=res.url)
    else:
        _log_attempt(db, item["id"], platform, "error", error=res.error)
    return out


def process_due_content(now: int | None = None, notify: bool = False) -> dict:
    """Process due scheduled content. Auto-post where possible; otherwise send a
    Telegram reminder. Returns a summary `{now, due, posted, reminders, errors}`."""
    now = now or int(time.time())
    db = init_reply_schema()
    due = due_content_items(now)
    posted: list[dict] = []
    reminders: list[dict] = []
    errors: list[dict] = []

    for item in due:
        cid = item["id"]
        platform = item.get("platform") or ""

        if _already_posted(db, cid, platform):
            posted.append({"id": cid, "platform": platform, "note": "already posted"})
            continue

        # Prefer auto-post if a publisher + creds exist.
        pub = _publisher_for(platform)
        if pub and pub._creds():
            res = autopost_item(item, platform)
            if res["ok"]:
                posted.append({"id": cid, "platform": platform, "url": res.get("remote_url")})
                continue
            # Publisher exists but failed; fall through to reminder with error note.
            errors.append({"id": cid, "platform": platform, "error": res.get("error")})

        # Reminder path: surface in Telegram with action buttons.
        try:
            from . import notify as _n
            if _n.is_configured() and _n.get_config()["events"].get("content_item"):
                _n.notify_once(
                    f"content:{cid}:{platform}", "content_item",
                    {"item": item, "platform": platform},
                )
                reminders.append({"id": cid, "platform": platform})
        except Exception as e:
            errors.append({"id": cid, "platform": platform, "error": f"notify failed: {e}"})

    return {
        "now": now, "due": len(due),
        "posted": posted, "reminders": reminders, "errors": errors,
    }
