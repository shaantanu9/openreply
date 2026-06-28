"""Reach Connections backend: list/verify/import/save/delete."""
from __future__ import annotations

import pytest


@pytest.fixture
def _db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db_mod.init_schema(db_mod.get_db())
    yield


def test_list_connections_all_sources(_db):
    from openreply.research import reach_connections as RC
    conns = RC.list_connections()
    sources = {c["source"] for c in conns}
    assert {"reddit", "twitter", "xiaohongshu", "linkedin", "xueqiu",
            "bilibili", "exa_search"} <= sources
    for c in conns:
        if c["kind"] == "public":
            # Public sources need no credential — always "ready", no login URL.
            assert c["connected"] is True
        else:
            assert c["connected"] is False
            assert c["login_url"].startswith("http")


def test_save_manual_cookie_then_connected(_db, monkeypatch):
    from openreply.research import reach_connections as RC
    # Pretend the live check passes once a cookie is stored.
    monkeypatch.setattr(RC, "_live_check", lambda s: (True, "OK — 3 rows"))
    res = RC.save_manual("xueqiu", "xq_a_token=abc; u=9")
    assert res["connected"] is True
    conns = {c["source"]: c for c in RC.list_connections()}
    assert conns["xueqiu"]["connected"] is True


def test_save_manual_api_key(_db, monkeypatch):
    from openreply.research import reach_connections as RC
    from openreply.core import credentials as C
    monkeypatch.setattr(RC, "_live_check", lambda s: (True, "OK"))
    RC.save_manual("exa_search", "exa_live_key")
    assert C.api_key("exa_search") == "exa_live_key"


def test_import_browser_no_cookies(_db, monkeypatch):
    from openreply.research import reach_connections as RC
    monkeypatch.setattr(RC._ce, "extract_cookies", lambda *a, **k: {})
    res = RC.import_browser("reddit")
    assert res["connected"] is False
    # The message guides the user to the manual-paste fallback and names the cookie.
    assert "manually" in res["message"].lower()
    assert "reddit_session" in res["message"]
    assert res["need"] == ["reddit_session", "token_v2"]


def test_import_browser_success(_db, monkeypatch):
    from openreply.research import reach_connections as RC
    monkeypatch.setattr(RC._ce, "extract_cookies",
                        lambda *a, **k: {"reddit_session": "sess"})
    monkeypatch.setattr(RC, "_live_check", lambda s: (True, "OK — 3 rows"))
    res = RC.import_browser("reddit")
    assert res["connected"] is True


def test_delete_connection(_db, monkeypatch):
    from openreply.research import reach_connections as RC
    from openreply.core import credentials as C
    C.set_credential("bilibili", {"SESSDATA": "x"}, kind="cookie")
    RC.delete_connection("bilibili")
    assert C.get_credential("bilibili") is None


def test_verify_returns_dict_offline(_db, monkeypatch):
    from openreply.research import reach_connections as RC
    monkeypatch.setattr(RC, "_live_check", lambda s: (False, "offline"))
    res = RC.verify_connection("reddit")
    assert res["source"] == "reddit" and res["connected"] is False
    assert res["message"] == "offline"


def test_live_check_swallows_fetch_errors(_db, monkeypatch):
    # _live_check must never raise even if the underlying fetcher blows up.
    from openreply.research import reach_connections as RC
    import openreply.sources.bilibili as bili
    monkeypatch.setattr(bili, "_get_json",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    ok, msg = RC._live_check("bilibili")
    assert ok is False and isinstance(msg, str)
