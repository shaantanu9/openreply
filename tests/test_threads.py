import openreply.sources.threads as mod

_FIXTURE = {"posts": [{
    "id": "55", "code": "Tabc",
    "text": "threads take on ai",
    "like_count": 60, "reply_count": 4,
    "username": "thuser", "taken_at": 1717200000,
}]}

def test_threads_missing_key_skips(monkeypatch):
    monkeypatch.delenv("SCRAPECREATORS_API_KEY", raising=False)
    rows = mod.fetch_threads("ai", limit=5)
    assert len(rows) == 1 and "_error" in rows[0]

def test_threads_maps_rows(monkeypatch):
    monkeypatch.setenv("SCRAPECREATORS_API_KEY", "k")
    monkeypatch.setattr(mod.sc, "get", lambda *a, **k: _FIXTURE)
    rows = mod.fetch_threads("ai", limit=5)
    assert rows[0]["source_type"] == "threads"
    assert rows[0]["score"] == 60 and rows[0]["author"] == "thuser"
