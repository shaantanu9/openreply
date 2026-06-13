import gapmap.sources.instagram as mod

_FIXTURE = {"items": [{
    "id": "991",
    "code": "Cabc",
    "caption": {"text": "ai reel"},
    "like_count": 800,
    "play_count": 12000,
    "comment_count": 12,
    "user": {"username": "iguser"},
    "taken_at": 1717200000,
}]}

def test_instagram_missing_key_skips(monkeypatch):
    monkeypatch.delenv("SCRAPECREATORS_API_KEY", raising=False)
    rows = mod.fetch_instagram("ai", limit=5)
    assert len(rows) == 1 and "_error" in rows[0]

def test_instagram_maps_rows(monkeypatch):
    monkeypatch.setenv("SCRAPECREATORS_API_KEY", "k")
    monkeypatch.setattr(mod.sc, "get", lambda *a, **k: _FIXTURE)
    rows = mod.fetch_instagram("ai", limit=5)
    assert rows[0]["source_type"] == "instagram"
    assert rows[0]["score"] == 800
    assert rows[0]["url"].endswith("Cabc/")
