"""Credential store + multi-platform cookie extraction registry."""
from __future__ import annotations

import pytest


@pytest.fixture
def _db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core import db as db_mod

    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db = db_mod.get_db()
    db_mod.init_schema(db)
    return db


def test_source_credentials_table_created(_db):
    assert "source_credentials" in _db.table_names()


def test_set_get_delete_roundtrip(_db):
    from openreply.core import credentials as C

    assert C.get_credential("reddit") is None
    C.set_credential("reddit", {"reddit_session": "abc"}, username="u", kind="cookie")
    cred = C.get_credential("reddit")
    assert cred["cookies"]["reddit_session"] == "abc"
    assert cred["username"] == "u"
    assert cred["kind"] == "cookie"
    assert C.has_credential("reddit") is True

    C.delete_credential("reddit")
    assert C.get_credential("reddit") is None
    assert C.has_credential("reddit") is False


def test_cookie_header_and_api_key(_db):
    from openreply.core import credentials as C

    assert C.cookie_header("xueqiu") == ""
    C.set_credential("xueqiu", {"xq_a_token": "t1", "u": "9"}, kind="cookie")
    hdr = C.cookie_header("xueqiu")
    assert "xq_a_token=t1" in hdr and "u=9" in hdr

    C.set_credential("exa_search", {"api_key": "exa_abc"}, kind="api_key")
    assert C.api_key("exa_search") == "exa_abc"


def test_get_credential_never_raises_on_bad_db(monkeypatch):
    from openreply.core import credentials as C

    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(C, "get_db", boom)
    assert C.get_credential("reddit") is None
    assert C.cookie_header("reddit") == ""


def test_extract_cookies_unknown_source_returns_empty():
    from openreply.sources._cookie_extract import extract_cookies

    assert extract_cookies("not_a_real_source") == {}


def test_extract_cookies_known_source_non_fatal(monkeypatch):
    # Even a known source must degrade to {} (no browser DB in CI), never raise.
    from openreply.sources import _cookie_extract as ce

    out = ce.extract_cookies("reddit")
    assert isinstance(out, dict)
