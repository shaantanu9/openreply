"""exa_search REST source (key-gated)."""
from __future__ import annotations

from openreply.sources import exa_search
from openreply.sources.exa_search import fetch_exa_search

_SAMPLE = {
    "results": [
        {"id": "a", "title": "Agent frameworks compared",
         "url": "https://blog.example/agents", "text": "long body text",
         "author": "Jane", "publishedDate": "2026-01-02T00:00:00Z"},
    ]
}


def test_exa_no_key_returns_empty(monkeypatch):
    monkeypatch.delenv("EXA_API_KEY", raising=False)
    monkeypatch.setattr(exa_search._creds, "api_key", lambda *a, **k: "")
    assert fetch_exa_search("agents") == []


def test_exa_with_env_key_shape(monkeypatch):
    monkeypatch.setenv("EXA_API_KEY", "exa_test")
    monkeypatch.setattr(exa_search, "_post_json", lambda *a, **k: _SAMPLE)
    rows = fetch_exa_search("agents", limit=5)
    assert len(rows) == 1
    r = rows[0]
    assert r["source_type"] == "exa"
    assert r["title"] == "Agent frameworks compared"
    assert r["author"] == "Jane"
    assert r["created_utc"] > 0


def test_exa_uses_stored_credential(monkeypatch):
    monkeypatch.delenv("EXA_API_KEY", raising=False)
    monkeypatch.setattr(exa_search._creds, "api_key", lambda *a, **k: "stored_key")
    captured = {}

    def fake_post(url, key, body):
        captured["key"] = key
        return _SAMPLE

    monkeypatch.setattr(exa_search, "_post_json", fake_post)
    rows = fetch_exa_search("agents")
    assert rows and captured["key"] == "stored_key"


def test_exa_never_raises(monkeypatch):
    monkeypatch.setenv("EXA_API_KEY", "exa_test")

    def boom(*a, **k):
        raise RuntimeError("500")

    monkeypatch.setattr(exa_search, "_post_json", boom)
    assert fetch_exa_search("agents") == []
