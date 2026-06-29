"""Tests for the scheduled content poster."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from sqlite_utils import Database


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Database:
    """Use a fresh temp DB for every test."""
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core import db as db_mod
    from openreply.reply.schema import init_reply_schema

    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    return init_reply_schema()


@pytest.fixture
def sample_item(db: Database) -> dict:
    """Insert a scheduled content item and return its row."""
    now = 1_000_000
    rec = {
        "id": "cid-1",
        "agent_id": "agent-1",
        "kind": "post",
        "platform": "x",
        "opportunity_id": "",
        "parent_id": "",
        "title": "Test post",
        "body": "Hello world",
        "compliant": 1,
        "compliance_notes": "",
        "status": "scheduled",
        "scheduled_at": now,
        "posted_at": 0,
        "remote_url": "",
        "angle": "",
        "created_at": now,
        "updated_at": now,
    }
    db["content_items"].insert(rec, pk="id")
    return rec


def test_due_content_items_selects_past_items(db: Database, sample_item: dict):
    from openreply.reply import content_poster

    due = content_poster.due_content_items(now=1_000_001)
    assert len(due) == 1
    assert due[0]["id"] == "cid-1"


def test_due_content_items_ignores_future_items(db: Database, sample_item: dict):
    from openreply.reply import content_poster

    due = content_poster.due_content_items(now=999_999)
    assert due == []


def test_autopost_item_no_publisher(db: Database, sample_item: dict):
    from openreply.reply import content_poster

    item = dict(sample_item)
    item["platform"] = "unknown_platform"
    res = content_poster.autopost_item(item)
    assert res["ok"] is False
    assert "no publisher" in res["error"]


def test_autopost_item_empty_body(db: Database):
    from openreply.reply import content_poster

    res = content_poster.autopost_item({"id": "cid-empty", "platform": "x", "body": "   "})
    assert res["ok"] is False
    assert "empty content" in res["error"]


def test_autopost_item_success(db: Database, sample_item: dict, monkeypatch: pytest.MonkeyPatch):
    from openreply.reply import content_poster
    from openreply.publish.base import PublishResult

    mock_publish = MagicMock(return_value=PublishResult(
        ok=True, platform="x", url="https://x.com/status/1", ids=["1"], parts=1
    ))
    monkeypatch.setattr("openreply.publish.x.publish", mock_publish)

    res = content_poster.autopost_item(sample_item)
    assert res["ok"] is True
    assert res["remote_url"] == "https://x.com/status/1"

    row = dict(db["content_items"].get("cid-1"))
    assert row["status"] == "posted"
    assert row["remote_url"] == "https://x.com/status/1"

    logs = list(db["content_publish_log"].rows_where("content_id = ?", ["cid-1"]))
    assert len(logs) == 1
    assert logs[0]["status"] == "ok"


def test_autopost_item_idempotent(db: Database, sample_item: dict, monkeypatch: pytest.MonkeyPatch):
    from openreply.reply import content_poster
    from openreply.publish.base import PublishResult

    mock_publish = MagicMock(return_value=PublishResult(
        ok=True, platform="x", url="https://x.com/status/1", ids=["1"], parts=1
    ))
    monkeypatch.setattr("openreply.publish.x.publish", mock_publish)

    content_poster.autopost_item(sample_item)
    # second attempt should be skipped because log already has an ok row
    res = content_poster.autopost_item(sample_item)
    assert res["ok"] is True
    assert mock_publish.call_count == 1


def test_process_due_content_autoposts_when_creds_present(
    db: Database, sample_item: dict, monkeypatch: pytest.MonkeyPatch
):
    from openreply.reply import content_poster
    from openreply.publish.base import PublishResult

    # Fake credentials for X.
    monkeypatch.setattr("openreply.publish.x._creds", lambda: {"access_token": "x-token"})
    mock_publish = MagicMock(return_value=PublishResult(
        ok=True, platform="x", url="https://x.com/status/1", ids=["1"], parts=1
    ))
    monkeypatch.setattr("openreply.publish.x.publish", mock_publish)

    summary = content_poster.process_due_content(now=1_000_002)
    assert summary["due"] == 1
    assert len(summary["posted"]) == 1
    assert summary["reminders"] == []


def test_process_due_content_sends_reminder_when_no_publisher(
    db: Database, sample_item: dict, monkeypatch: pytest.MonkeyPatch
):
    from openreply.reply import content_poster

    notify_calls = []

    def _fake_notify_once(key: str, event: str, payload: dict):
        notify_calls.append((key, event, payload))
        return {"telegram": {"ok": True}}

    monkeypatch.setattr("openreply.reply.notify.is_configured", lambda: True)
    monkeypatch.setattr("openreply.reply.notify.get_config", lambda: {
        "events": {"content_item": True}, "enabled": True,
    })
    monkeypatch.setattr("openreply.reply.notify.notify_once", _fake_notify_once)

    # No publisher for x because x._creds returns None.
    summary = content_poster.process_due_content(now=1_000_002)
    assert summary["due"] == 1
    assert summary["posted"] == []
    assert len(summary["reminders"]) == 1
    assert notify_calls[0][1] == "content_item"
