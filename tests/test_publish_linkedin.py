"""Tests for the LinkedIn outbound publisher."""
from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest
from sqlite_utils import Database


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Database:
    """Use a fresh temp DB for every test."""
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core import db as db_mod

    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    return db_mod.get_db()


@pytest.fixture
def linkedin_creds(db: Database):
    """Store LinkedIn publish credentials."""
    from openreply.core.credentials import set_credential

    set_credential(
        "linkedin_publish",
        {"access_token": "test-token", "author_urn": "urn:li:person:test123"},
        kind="api_key",
    )


def test_plan_without_creds():
    from openreply.publish import linkedin

    out = linkedin.plan("Hello LinkedIn")
    assert out["platform"] == "linkedin"
    assert out["parts"] == 1
    assert out["body"] == "Hello LinkedIn"
    assert out["has_creds"] is False


def test_plan_with_creds(linkedin_creds):
    from openreply.publish import linkedin

    out = linkedin.plan("Hello LinkedIn")
    assert out["has_creds"] is True


def test_publish_empty_body():
    from openreply.publish import linkedin

    res = linkedin.publish("   ")
    assert res.ok is False
    assert "empty" in res.error.lower()


def test_publish_no_creds(monkeypatch: pytest.MonkeyPatch):
    from openreply.publish import linkedin

    monkeypatch.setattr(linkedin, "_creds", lambda: None)
    res = linkedin.publish("Hello LinkedIn")
    assert res.ok is False
    assert "no LinkedIn credentials" in res.error


def test_publish_dry_run(linkedin_creds):
    from openreply.publish import linkedin

    res = linkedin.publish("Hello LinkedIn", dry_run=True)
    assert res.ok is True
    assert res.platform == "linkedin"
    assert res.parts == 1


def _mock_response(status_code: int = 201, headers: dict | None = None, json: Any = None, text: str = "") -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.headers = headers or {}
    resp.json.return_value = json or {}
    resp.text = text
    return resp


def test_publish_success(linkedin_creds, monkeypatch: pytest.MonkeyPatch):
    from openreply.publish import linkedin

    mock_post = MagicMock(return_value=_mock_response(
        201, {"X-RestLi-Id": "urn:li:share:123456789"}
    ))
    monkeypatch.setattr("requests.post", mock_post)

    res = linkedin.publish("Hello LinkedIn")
    assert res.ok is True
    assert res.platform == "linkedin"
    assert res.ids == ["urn:li:share:123456789"]
    assert res.url == "https://www.linkedin.com/feed/update/urn:li:share:123456789"
    assert res.parts == 1

    call_args = mock_post.call_args
    assert call_args.kwargs["json"]["author"] == "urn:li:person:test123"
    assert call_args.kwargs["json"]["specificContent"]["com.linkedin.ugc.ShareContent"]["shareCommentary"]["text"] == "Hello LinkedIn"
    assert call_args.kwargs["headers"]["Authorization"] == "Bearer test-token"


def test_publish_api_error(linkedin_creds, monkeypatch: pytest.MonkeyPatch):
    from openreply.publish import linkedin

    mock_post = MagicMock(return_value=_mock_response(
        403, text='{"status": 403, "message": "Not enough permissions"}'
    ))
    monkeypatch.setattr("requests.post", mock_post)

    res = linkedin.publish("Hello LinkedIn")
    assert res.ok is False
    assert "LinkedIn API 403" in res.error


def test_publish_network_error(linkedin_creds, monkeypatch: pytest.MonkeyPatch):
    from openreply.publish import linkedin

    def _boom(*_, **__):
        raise RuntimeError("timeout")

    monkeypatch.setattr("requests.post", _boom)

    res = linkedin.publish("Hello LinkedIn")
    assert res.ok is False
    assert "network error" in res.error
