"""Inbox/Opportunities backend lifecycle tests.

Covers the workspace flow the Inbox screen drives: draft versioning,
snooze + auto-resurface, the approve→queue→posted lifecycle, and
list search/sort/offset pagination. Pure SQLite (no LLM): we exercise
save_draft (persists text, no model call) rather than generate_reply.
"""
from __future__ import annotations

import time


def _db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core.db import get_db
    from openreply.reply.schema import init_reply_schema

    get_db.cache_clear()
    return init_reply_schema()


def _opp(db, oid, *, title="t", body="", author="a", sub="s",
         score=0.5, status="saved", platform="x", found_at=1000):
    db["reply_opportunities"].insert({
        "id": oid, "brand_id": "default", "platform": platform, "post_id": oid,
        "title": title, "body": body, "url": f"https://x/{oid}", "author": author,
        "sub": sub, "score": score, "engagement": score, "status": status,
        "found_at": found_at,
    }, pk="id", alter=True)


# ── draft versioning ─────────────────────────────────────────────────


def test_save_draft_creates_versions(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch)
    from openreply.reply.generate import save_draft, list_drafts, current_draft

    _opp(db, "o1", status="saved")
    r1 = save_draft("o1", "first take")
    assert not r1.get("error"), r1
    r2 = save_draft("o1", "second, better take")

    drafts = list_drafts("o1")
    assert [d["version"] for d in drafts] == [2, 1]          # newest first
    assert drafts[0]["source"] == "edited"
    assert current_draft("o1")["text"] == "second, better take"
    # persisting a draft moves the opportunity into the drafting lane
    assert dict(db["reply_opportunities"].get("o1"))["status"] == "drafted"


# ── snooze + auto-resurface ──────────────────────────────────────────


def test_snooze_hides_then_resurfaces(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch)
    from openreply.reply.opportunity import snooze, list_opportunities

    _opp(db, "s1", status="new", score=0.9)
    assert snooze("s1", hours=24).get("status") == "snoozed"

    # default (status=None) list hides snoozed items
    assert "s1" not in {o["id"] for o in list_opportunities()}
    assert "s1" in {o["id"] for o in list_opportunities(status="snoozed")}

    # force the snooze window into the past → next list call resurfaces it to `new`
    db["reply_opportunities"].update("s1", {"snooze_until": int(time.time()) - 10})
    ids = {o["id"]: o["status"] for o in list_opportunities()}
    assert ids.get("s1") == "new"


# ── approve → queue → posted ─────────────────────────────────────────


def test_approve_queue_posted_lifecycle(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch)
    from openreply.reply.opportunity import approve, queue, mark_posted

    _opp(db, "l1", status="drafted")
    assert approve("l1")["status"] == "ready"
    assert dict(db["reply_opportunities"].get("l1"))["status"] == "ready"

    q = queue("l1", scheduled_at=1893456000)
    assert q["status"] == "queued" and q["scheduled_at"] == 1893456000

    mp = mark_posted("l1")
    assert mp["status"] == "posted"
    row = dict(db["reply_opportunities"].get("l1"))
    assert row["status"] == "posted" and (row.get("posted_at") or 0) > 0


# ── list: search / sort / offset ─────────────────────────────────────


def test_list_search_sort_offset(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch)
    from openreply.reply.opportunity import list_opportunities, count_opportunities

    _opp(db, "a", title="Alpha launch", score=0.3, found_at=100)
    _opp(db, "b", title="Beta notes", score=0.9, found_at=300)
    _opp(db, "c", title="Gamma alpha thread", score=0.6, found_at=200)

    # search LIKEs title/body/author/sub (case-insensitive)
    hits = {o["id"] for o in list_opportunities(status="saved", query="alpha")}
    assert hits == {"a", "c"}

    # sort by score desc
    by_score = [o["id"] for o in list_opportunities(status="saved", sort="score")]
    assert by_score == ["b", "c", "a"]

    # sort by recent (found_at fallback) desc
    by_recent = [o["id"] for o in list_opportunities(status="saved", sort="recent")]
    assert by_recent[0] == "b"  # found_at=300 newest

    # offset paginates the score-sorted set
    page2 = [o["id"] for o in list_opportunities(status="saved", sort="score", limit=1, offset=1)]
    assert page2 == ["c"]

    assert count_opportunities(status="saved") == 3
    assert count_opportunities(status="saved", query="alpha") == 2
