"""Scheduled poster + reminder for queued replies.

A reply opportunity reaches `queued` (with a `scheduled_at` epoch) via
`opportunity.queue()`. This module processes the ones whose schedule has
arrived: it tries a **best-effort auto-post** where a write-capable client
exists, and otherwise surfaces a **reminder** so the user posts manually.

Reddit / social *write* APIs are not wired today (the PRAW client is read-only —
no OAuth refresh token), so `_autopost` cleanly returns `(False, reason)` and the
item stays `queued` and "due" for a manual post. The hook is here for when write
credentials land. The reminder reaches the user even when the desktop app is
closed, because the launchd scheduler runs this headless and it fires a native
notification.
"""
from __future__ import annotations

import sys
import time

from .agent import active_id
from .generate import current_draft
from .schema import init_reply_schema


def _active_brand_id() -> str:
    return active_id() or "default"


def due_opportunities(now: int | None = None) -> list[dict]:
    """Queued opportunities for the active brand whose `scheduled_at` has arrived."""
    now = now or int(time.time())
    db = init_reply_schema()
    rows = db["reply_opportunities"].rows_where(
        "brand_id = ? AND status = 'queued' AND scheduled_at IS NOT NULL "
        "AND scheduled_at <= ?",
        [_active_brand_id(), now],
        order_by="scheduled_at asc",
    )
    return [dict(r) for r in rows]


def _autopost(opp: dict, text: str) -> tuple[bool, str]:
    """Best-effort auto-post. Returns (posted, message).

    Today every platform's write path is disabled (read-only clients), so this
    returns (False, reason) and the caller falls back to a reminder. When a
    write-enabled Reddit account is connected (config.has_oauth → a PRAW
    refresh token), the Reddit branch is where the actual `submission.reply`
    would go.
    """
    platform = (opp.get("platform") or "").lower()
    if platform in ("reddit", "reddit_free"):
        try:
            from ..core.config import load_config
            if not load_config().has_oauth:
                return False, "no Reddit write credentials — connect a write-enabled account"
            # Write path (PRAW submission.reply) intentionally not enabled yet.
            return False, "auto-post not enabled for this account"
        except Exception as e:  # pragma: no cover - defensive
            return False, f"autopost unavailable: {e}"
    return False, f"no write API for {platform or 'platform'}"


def _notify(title: str, body: str) -> None:
    """Native macOS notification (best-effort, no-op elsewhere). The poster runs
    headless via launchd, so this is how a reminder reaches a closed app."""
    if sys.platform != "darwin":
        return
    try:
        import subprocess
        safe_b = (body or "").replace('"', "'")
        safe_t = (title or "").replace('"', "'")
        subprocess.run(
            ["osascript", "-e",
             f'display notification "{safe_b}" with title "{safe_t}"'],
            timeout=10, capture_output=True,
        )
    except Exception:
        pass


def process_due(now: int | None = None, notify: bool = False) -> dict:
    """Process due queued replies. Auto-post where possible; otherwise collect a
    reminder. Returns a summary `{now, due, posted, reminders, errors}`."""
    now = now or int(time.time())
    db = init_reply_schema()
    due = due_opportunities(now)
    posted: list[dict] = []
    reminders: list[dict] = []
    errors: list[dict] = []
    for opp in due:
        oid = opp["id"]
        draft = current_draft(oid) or {}
        text = (draft.get("text") or "").strip()
        if not text:
            errors.append({"id": oid, "error": "no draft to post"})
            continue
        ok, msg = _autopost(opp, text)
        if ok:
            try:
                db["reply_opportunities"].update(
                    oid, {"status": "posted", "posted_at": now, "updated_at": now})
            except Exception:
                pass
            posted.append({"id": oid, "title": opp.get("title")})
        else:
            reminders.append({
                "id": oid, "title": opp.get("title"),
                "url": opp.get("url"), "reason": msg,
            })
            # Rich push (Telegram draft + buttons / Slack) — deduped per reply so
            # a still-queued item doesn't re-ping every scheduler tick.
            try:
                from . import notify as _n
                if _n.is_configured() and _n.get_config()["events"].get("reply"):
                    _n.notify_once(f"reply:{oid}", "reply", {"opp": opp, "draft": text})
            except Exception:
                pass
    if notify and reminders:
        n = len(reminders)
        _notify("OpenReply — replies due",
                f"{n} repl{'y' if n == 1 else 'ies'} ready to post.")
    return {
        "now": now, "due": len(due),
        "posted": posted, "reminders": reminders, "errors": errors,
    }
