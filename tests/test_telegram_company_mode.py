"""Telegram company-mode tests.

Covers multi-target config, legacy migration, channel-safe delivery,
and operator attribution from the bot through to opportunity/draft rows.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock


def _db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core.db import get_db
    from openreply.reply.schema import init_reply_schema

    get_db.cache_clear()
    return init_reply_schema()


def _mock_urlopen(monkeypatch, responses=None):
    """Patch urllib.request.urlopen so Telegram API calls return controlled bodies."""
    responses = responses or [{}]
    calls = []

    def _fake_open(req, timeout=None):
        calls.append((req.full_url, json.loads(req.data.decode("utf-8")) if req.data else None))
        body = json.dumps({"ok": True, "result": responses.pop(0) if responses else {}})
        resp = MagicMock()
        resp.read.return_value = body.encode("utf-8")
        resp.__enter__ = lambda s: s
        resp.__exit__ = lambda *a: None
        return resp

    monkeypatch.setattr("urllib.request.urlopen", _fake_open)
    return calls


def test_legacy_telegram_chat_migrates_to_targets(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch)
    from openreply.reply import notify as n

    n.set_config(telegram_token="tok", telegram_chat="-123,-456")
    targets = n.get_targets()
    assert {t["chat_id"] for t in targets} == {"-123", "-456"}


def test_set_target_and_enabled_filter(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch)
    from openreply.reply import notify as n

    n.set_target("-1001", type_="group", label="Marketing")
    n.set_target("-1002", type_="channel", label="Announcements", enabled=False)
    assert len(n.get_targets()) == 2
    assert len(n.get_targets(enabled_only=True)) == 1
    assert n.get_targets(enabled_only=True)[0]["chat_id"] == "-1001"


def test_send_telegram_broadcasts_to_all_targets(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch)
    from openreply.reply import notify as n

    n.set_config(telegram_token="tok")
    n.set_target("-111", type_="group")
    n.set_target("-222", type_="group")
    calls = _mock_urlopen(monkeypatch)

    ok, msg = n.send_telegram("hello", buttons=[{"text": "Go", "data": "x:y"}])
    assert ok is True
    assert msg == "ok"
    chat_ids = [c[1]["chat_id"] for c in calls]
    assert chat_ids == ["-111", "-222"]
    # both got inline keyboard
    assert all(c[1].get("reply_markup") for c in calls)


def test_channel_target_receives_button_free_message(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch)
    from openreply.reply import notify as n

    n.set_config(telegram_token="tok")
    n.set_target("-1001", type_="channel")
    calls = _mock_urlopen(monkeypatch)

    n.send_telegram("announcement", buttons=[{"text": "Go", "data": "x:y"}])
    payload = calls[0][1]
    assert payload["chat_id"] == "-1001"
    assert "reply_markup" not in payload


def test_send_telegram_retries_without_buttons_on_channel_error(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch)
    from openreply.reply import notify as n

    n.set_config(telegram_token="tok")
    n.set_target("-999", type_="group")  # marked group, but Telegram rejects buttons
    calls = _mock_urlopen(monkeypatch)

    # first call fails with a channel/buttons rights error, second succeeds
    responses = [{}, {}]
    call_idx = [0]

    def _fake_open(req, timeout=None):
        calls.append((req.full_url, json.loads(req.data.decode("utf-8"))))
        idx = call_idx[0]
        call_idx[0] += 1
        if idx == 0:
            from urllib.error import HTTPError
            raise HTTPError(req.full_url, 400, "Bad Request: not enough rights to send buttons to channels", {}, None)
        body = json.dumps({"ok": True, "result": responses.pop(0)})
        resp = MagicMock()
        resp.read.return_value = body.encode("utf-8")
        resp.__enter__ = lambda s: s
        resp.__exit__ = lambda *a: None
        return resp

    monkeypatch.setattr("urllib.request.urlopen", _fake_open)
    ok, msg = n.send_telegram("hello", buttons=[{"text": "Go", "data": "x:y"}])
    assert ok is True
    assert len(calls) == 2
    assert "reply_markup" in calls[0][1]
    assert "reply_markup" not in calls[1][1]


def test_operator_attribution_on_set_status(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch)
    from openreply.reply.opportunity import set_status

    db["reply_opportunities"].insert({
        "id": "o1", "brand_id": "default", "platform": "reddit_free",
        "post_id": "p1", "title": "t", "body": "b", "score": 0.5,
        "status": "new", "found_at": 1,
    }, pk="id", alter=True)

    r = set_status("o1", "skipped", operator="@alice")
    assert r["operator"] == "@alice"
    row = dict(db["reply_opportunities"].get("o1"))
    assert row["operator"] == "@alice"
    assert row["operator_actioned_at"] > 0


def test_operator_attribution_on_save_draft(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch)
    from openreply.reply.generate import save_draft

    db["reply_opportunities"].insert({
        "id": "o2", "brand_id": "default", "platform": "reddit_free",
        "post_id": "p2", "title": "t", "body": "b", "score": 0.5,
        "status": "saved", "found_at": 1,
    }, pk="id", alter=True)

    rec = save_draft("o2", "draft text", operator="@bob")
    assert rec["operator"] == "@bob"
    opp = dict(db["reply_opportunities"].get("o2"))
    assert opp["operator"] == "@bob"


def test_bot_operator_name_from_callback_query():
    from openreply.reply.bot import _operator_name

    assert _operator_name({"from": {"username": "alice", "id": 7}}) == "@alice"
    assert _operator_name({"from": {"first_name": "Alice", "id": 7}}) == "Alice (id 7)"
    assert _operator_name({"from": {"id": 7}}) == "id 7"
    assert _operator_name({}) == "unknown"


def test_bot_handle_action_passes_operator_to_skip(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch)
    from openreply.reply.bot import _handle_action

    db["reply_opportunities"].insert({
        "id": "o3", "brand_id": "default", "platform": "reddit_free",
        "post_id": "p3", "title": "t", "body": "b", "score": 0.5,
        "status": "new", "found_at": 1,
    }, pk="id", alter=True)

    toast, msg, buttons = _handle_action("skip", "o3", operator="@carol")
    assert toast == "Skipped"
    row = dict(db["reply_opportunities"].get("o3"))
    assert row["operator"] == "@carol"
    assert row["status"] == "skipped"


def test_send_telegram_single_chat_backward_compat(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch)
    from openreply.reply import notify as n

    n.set_config(telegram_token="tok")
    calls = _mock_urlopen(monkeypatch)

    ok, msg = n.send_telegram("direct", chat="-777")
    assert ok is True
    assert len(calls) == 1
    assert calls[0][1]["chat_id"] == "-777"


def test_operator_footer_appended(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch)
    from openreply.reply import notify as n

    n.set_config(telegram_token="tok")
    n.set_target("-1")
    calls = _mock_urlopen(monkeypatch)

    n.send_telegram("body", operator="@dave")
    text = calls[0][1]["text"]
    assert "via @dave" in text
