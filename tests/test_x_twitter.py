"""Tests for the X/Twitter source adapter."""
import openreply.sources.x_twitter as mod


def test_x_no_backend_skips(monkeypatch):
    for k in ("AUTH_TOKEN", "CT0", "XAI_API_KEY", "XQUIK_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(mod.ce, "x_auth_from_browsers", lambda: None)
    rows = mod.fetch_x("ai agents", limit=5)
    assert len(rows) == 1 and "_error" in rows[0]


def test_x_xai_backend_maps_rows(monkeypatch):
    for k in ("AUTH_TOKEN", "CT0", "XQUIK_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(mod.ce, "x_auth_from_browsers", lambda: None)
    monkeypatch.setenv("XAI_API_KEY", "xai-k")
    monkeypatch.setattr(mod, "_fetch_xai", lambda q, n: [{
        "id": "1", "author_handle": "@dev", "text": "agents are great",
        "url": "https://x.com/dev/status/1", "likes": 99, "replies": 5,
        "created_utc": 1717200000.0,
    }])
    rows = mod.fetch_x("agents", limit=5)
    assert rows[0]["source_type"] == "x"
    assert rows[0]["author"] == "dev"
    assert rows[0]["score"] == 99


def test_x_xquik_backend_maps_rows(monkeypatch):
    for k in ("AUTH_TOKEN", "CT0", "XAI_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(mod.ce, "x_auth_from_browsers", lambda: None)
    monkeypatch.setenv("XQUIK_API_KEY", "xq-k")
    monkeypatch.setattr(mod, "_fetch_xquik", lambda q, n: [{
        "id": "2", "author_handle": "researcher", "text": "xquik result",
        "url": "https://x.com/researcher/status/2", "likes": 42, "replies": 3,
        "created_utc": 1717300000.0,
    }])
    rows = mod.fetch_x("test query", limit=5)
    assert rows[0]["source_type"] == "x"
    assert rows[0]["author"] == "researcher"
    assert rows[0]["score"] == 42
    assert rows[0]["num_comments"] == 3


def test_x_row_id_prefixed(monkeypatch):
    for k in ("AUTH_TOKEN", "CT0", "XQUIK_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(mod.ce, "x_auth_from_browsers", lambda: None)
    monkeypatch.setenv("XAI_API_KEY", "xai-k")
    monkeypatch.setattr(mod, "_fetch_xai", lambda q, n: [{
        "id": "999", "author_handle": "user1", "text": "hello",
        "url": "https://x.com/user1/status/999", "likes": 0, "replies": 0,
        "created_utc": 0.0,
    }])
    rows = mod.fetch_x("hello", limit=5)
    assert rows[0]["id"] == "x_999"


def test_x_limit_respected(monkeypatch):
    for k in ("AUTH_TOKEN", "CT0", "XQUIK_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(mod.ce, "x_auth_from_browsers", lambda: None)
    monkeypatch.setenv("XAI_API_KEY", "xai-k")
    many = [{"id": str(i), "author_handle": "u", "text": f"t{i}",
             "url": f"https://x.com/u/status/{i}", "likes": i, "replies": 0,
             "created_utc": 0.0} for i in range(10)]
    monkeypatch.setattr(mod, "_fetch_xai", lambda q, n: many)
    rows = mod.fetch_x("test", limit=3)
    assert len(rows) == 3


def test_x_backend_exception_falls_through(monkeypatch):
    """A backend that raises must not propagate; chain continues."""
    for k in ("AUTH_TOKEN", "CT0", "XAI_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(mod.ce, "x_auth_from_browsers", lambda: None)
    monkeypatch.setenv("XQUIK_API_KEY", "xq-k")

    def _boom(q, n):
        raise RuntimeError("network dead")

    monkeypatch.setattr(mod, "_fetch_bird", _boom)
    monkeypatch.setattr(mod, "_fetch_xai", _boom)
    monkeypatch.setattr(mod, "_fetch_xquik", lambda q, n: [{
        "id": "3", "author_handle": "safe", "text": "safe result",
        "url": "https://x.com/safe/status/3", "likes": 10, "replies": 1,
        "created_utc": 1717400000.0,
    }])
    rows = mod.fetch_x("test", limit=5)
    assert rows[0]["author"] == "safe"


def test_x_fetch_bird_skips_without_auth(monkeypatch):
    monkeypatch.delenv("AUTH_TOKEN", raising=False)
    result = mod._fetch_bird("test", 5)
    assert result == []


def test_x_fetch_xai_skips_without_key(monkeypatch):
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    result = mod._fetch_xai("test", 5)
    assert result == []


def test_x_fetch_xquik_skips_without_key(monkeypatch):
    monkeypatch.delenv("XQUIK_API_KEY", raising=False)
    result = mod._fetch_xquik("test", 5)
    assert result == []


def test_x_cookie_extract_populates_env(monkeypatch):
    """When cookie-extract succeeds, AUTH_TOKEN/CT0 land in env for bird."""
    for k in ("AUTH_TOKEN", "CT0", "XAI_API_KEY", "XQUIK_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(mod.ce, "x_auth_from_browsers",
                        lambda: {"auth_token": "tok123", "ct0": "ct0abc"})
    # bird still won't run (no node/mjs in test env) → falls to _error
    rows = mod.fetch_x("test", limit=5)
    import os
    assert os.environ.get("AUTH_TOKEN") == "tok123"
    assert os.environ.get("CT0") == "ct0abc"
    # result is still _error because bird/xai/xquik all need real keys
    assert "_error" in rows[0] or rows[0].get("source_type") == "x"
