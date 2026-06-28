"""x_twitter falls back to a stored credential for the free (bird) path."""
from __future__ import annotations

import pytest


@pytest.fixture
def _db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("AUTH_TOKEN", raising=False)
    monkeypatch.delenv("CT0", raising=False)
    from openreply.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db_mod.init_schema(db_mod.get_db())
    yield


def test_stored_cookie_populates_auth_env(_db, monkeypatch):
    from openreply.core import credentials as C
    from openreply.sources import x_twitter

    C.set_credential("twitter", {"auth_token": "AT", "ct0": "C0"}, kind="cookie")

    seen = {}

    def fake_bird(query, limit):
        seen["auth"] = __import__("os").environ.get("AUTH_TOKEN")
        return [{"id": "1", "author_handle": "bob", "text": "hi",
                 "url": "https://x.com/bob/status/1", "likes": 2, "replies": 0,
                 "created_utc": 0.0}]

    monkeypatch.setattr(x_twitter, "_fetch_bird", fake_bird)
    rows = x_twitter.fetch_x("ai", limit=5)
    assert rows and rows[0]["source_type"] == "x"
    assert seen["auth"] == "AT"


def test_no_backend_returns_error_sentinel(_db, monkeypatch):
    from openreply.sources import x_twitter
    monkeypatch.setattr(x_twitter.ce, "x_auth_from_browsers", lambda: None)
    monkeypatch.setattr(x_twitter, "_fetch_bird", lambda q, l: [])
    monkeypatch.setattr(x_twitter, "_fetch_xai", lambda q, l: [])
    monkeypatch.setattr(x_twitter, "_fetch_xquik", lambda q, l: [])
    rows = x_twitter.fetch_x("ai")
    assert rows and "_error" in rows[0]
