"""Tests for Telegram notifications + bot actions on Compose content_items."""
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
    now = 1_000_000
    rec = {
        "id": "cid-1",
        "agent_id": "agent-1",
        "kind": "post",
        "platform": "linkedin",
        "opportunity_id": "",
        "parent_id": "",
        "title": "Why tagging fails",
        "body": "Students don't quit because they lack folders...",
        "compliant": 1,
        "compliance_notes": "",
        "status": "draft",
        "scheduled_at": 0,
        "posted_at": 0,
        "remote_url": "",
        "angle": "manual tagging pain",
        "created_at": now,
        "updated_at": now,
    }
    db["content_items"].insert(rec, pk="id")
    return rec


def test_fmt_content_item(db: Database, sample_item: dict):
    from openreply.reply.notify import _fmt_content_item

    tg, sk, buttons = _fmt_content_item(sample_item)
    assert "Why tagging fails" in tg
    assert "linkedin" in tg
    assert "Students don't quit" in tg
    assert len(buttons) == 4
    assert buttons[0]["data"] == "copy:cid-1:linkedin"
    assert buttons[1]["data"] == "posted:cid-1:linkedin"


def test_fmt_content_item_uses_variant(db: Database, sample_item: dict):
    from openreply.reply.notify import _fmt_content_item

    sample_item["variants_json"] = '{"linkedin": "VARIANT BODY", "x": "x body"}'
    tg, _sk, _buttons = _fmt_content_item(sample_item, platform="linkedin")
    assert "VARIANT BODY" in tg


def test_notify_content_item_dispatches(db: Database, sample_item: dict, monkeypatch: pytest.MonkeyPatch):
    from openreply.reply import notify as n

    n.set_config(enabled=True, telegram_token="tok", telegram_chat="-1")
    calls = []

    def _fake_send_telegram(text, buttons=None, token=None, chat=None):
        calls.append((text, buttons))
        return True, "ok"

    monkeypatch.setattr(n, "send_telegram", _fake_send_telegram)

    res = n.notify_content_item(sample_item)
    assert res["telegram"]["ok"] is True
    assert len(calls) == 1
    assert "Why tagging fails" in calls[0][0]
    assert calls[0][1] is not None


def test_bot_content_copy_action(db: Database, sample_item: dict):
    from openreply.reply.bot import _handle_action

    toast, msg, buttons = _handle_action("copy", "cid-1:linkedin")
    assert "Copied" in toast
    assert "Students don't quit" in msg
    assert buttons == []


def test_bot_content_posted_action(db: Database, sample_item: dict):
    from openreply.reply.bot import _handle_action

    toast, msg, buttons = _handle_action("posted", "cid-1:linkedin")
    assert "Marked posted" in toast
    row = dict(db["content_items"].get("cid-1"))
    assert row["status"] == "posted"
    assert row["posted_at"] > 0


def test_bot_content_schedule_action(db: Database, sample_item: dict):
    from openreply.reply.bot import _handle_action

    toast, msg, buttons = _handle_action("schedule", "cid-1")
    assert "Scheduled" in toast
    row = dict(db["content_items"].get("cid-1"))
    assert row["status"] == "scheduled"
    assert row["scheduled_at"] > 0


def test_bot_content_regen_action(db: Database, sample_item: dict, monkeypatch: pytest.MonkeyPatch):
    from openreply.reply import bot
    from openreply.reply import content as _content

    def _fake_generate(kind, *, agent_id=None, platform=None, angle=None, **kwargs):
        return {
            "id": "cid-2",
            "agent_id": agent_id,
            "kind": kind,
            "platform": platform,
            "title": "Regenerated",
            "body": "Fresh take on tagging.",
        }

    monkeypatch.setattr(_content, "generate_content", _fake_generate)
    # Ensure the new row is loadable by the bot.
    db["content_items"].insert(
        {
            "id": "cid-2",
            "agent_id": "agent-1",
            "kind": "post",
            "platform": "linkedin",
            "opportunity_id": "",
            "parent_id": "",
            "title": "Regenerated",
            "body": "Fresh take on tagging.",
            "compliant": 1,
            "compliance_notes": "",
            "status": "draft",
            "scheduled_at": 0,
            "posted_at": 0,
            "remote_url": "",
            "angle": "",
            "created_at": 1_000_000,
            "updated_at": 1_000_000,
        },
        pk="id",
    )

    toast, msg, buttons = bot._handle_action("regen", "cid-1:linkedin")
    assert "Regenerated" in toast
    assert "Fresh take on tagging" in msg
    assert len(buttons) == 4


def test_bot_draft_command_parses_platform_and_angle(db: Database, monkeypatch: pytest.MonkeyPatch):
    from openreply.reply import bot
    from openreply.reply import content as _content

    captured = {}

    def _fake_generate(kind, *, agent_id=None, platform=None, angle=None, **kwargs):
        captured["platform"] = platform
        captured["angle"] = angle
        return {
            "id": "cid-draft",
            "agent_id": agent_id,
            "kind": kind,
            "platform": platform,
            "title": "Draft",
            "body": "Draft body",
        }

    monkeypatch.setattr(_content, "generate_content", _fake_generate)
    db["content_items"].insert(
        {
            "id": "cid-draft",
            "agent_id": "",
            "kind": "post",
            "platform": "linkedin",
            "opportunity_id": "",
            "parent_id": "",
            "title": "Draft",
            "body": "Draft body",
            "compliant": 1,
            "compliance_notes": "",
            "status": "draft",
            "scheduled_at": 0,
            "posted_at": 0,
            "remote_url": "",
            "angle": "",
            "created_at": 1_000_000,
            "updated_at": 1_000_000,
        },
        pk="id",
    )

    msg, buttons = bot._handle_draft_command("/draft linkedin Why folders fail")
    assert captured["platform"] == "linkedin"
    assert captured["angle"] == "Why folders fail"
    assert "Draft body" in msg
    assert len(buttons) == 4
