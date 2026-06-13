import gapmap.sources.tiktok as mod

_FIXTURE = {"search_item_list": [{
    "aweme_info": {
        "aweme_id": "7311",
        "desc": "best ai tools #ai",
        "share_url": "https://www.tiktok.com/@x/video/7311",
        "statistics": {"digg_count": 1200, "play_count": 50000, "comment_count": 30},
        "author": {"unique_id": "creatorx"},
        "create_time": 1717200000,
    }
}]}

def test_tiktok_missing_key_skips(monkeypatch):
    monkeypatch.delenv("SCRAPECREATORS_API_KEY", raising=False)
    rows = mod.fetch_tiktok("ai tools", limit=5)
    assert len(rows) == 1 and "_error" in rows[0]

def test_tiktok_maps_rows(monkeypatch):
    monkeypatch.setenv("SCRAPECREATORS_API_KEY", "k")
    monkeypatch.setattr(mod.sc, "get", lambda *a, **k: _FIXTURE)
    rows = mod.fetch_tiktok("ai tools", limit=5)
    assert rows[0]["source_type"] == "tiktok"
    assert rows[0]["score"] == 1200
    assert rows[0]["author"] == "creatorx"
    assert "views=50000" in rows[0]["flair"]
