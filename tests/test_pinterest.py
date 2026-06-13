import gapmap.sources.pinterest as mod

_FIXTURE = {"results": [{
    "id": "99", "grid_title": "AI workflow",
    "description": "a useful pin about ai",
    "repin_count": 300, "comment_count": 2,
    "pinner": {"username": "pinuser"}, "board": {"name": "AI"},
}]}

def test_pinterest_missing_key_skips(monkeypatch):
    monkeypatch.delenv("SCRAPECREATORS_API_KEY", raising=False)
    rows = mod.fetch_pinterest("ai", limit=5)
    assert len(rows) == 1 and "_error" in rows[0]

def test_pinterest_maps_rows(monkeypatch):
    monkeypatch.setenv("SCRAPECREATORS_API_KEY", "k")
    monkeypatch.setattr(mod.sc, "get", lambda *a, **k: _FIXTURE)
    rows = mod.fetch_pinterest("ai", limit=5)
    assert rows[0]["source_type"] == "pinterest"
    assert "saves=300" in rows[0]["flair"]
    assert rows[0]["url"].endswith("/pin/99/")
