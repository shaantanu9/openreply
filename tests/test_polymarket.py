import gapmap.sources.polymarket as mod

class _FakeResp:
    def __init__(self, payload, status=200):
        self._payload, self.status_code = payload, status
    def json(self): return self._payload
    def raise_for_status(self): pass

_FIXTURE = {
    "events": [{
        "title": "Will X happen by 2026?",
        "slug": "will-x-happen",
        "volume": 66000,
        "markets": [{
            "outcomes": "[\"Yes\", \"No\"]",
            "outcomePrices": "[\"0.74\", \"0.26\"]",
            "volume": 66000,
            "oneMonthPriceChange": 0.12,
        }],
    }]
}

def test_polymarket_maps_rows(monkeypatch):
    monkeypatch.setattr(mod.httpx, "get", lambda *a, **k: _FakeResp(_FIXTURE))
    rows = mod.fetch_polymarket("X", limit=5)
    assert rows and rows[0]["source_type"] == "polymarket"
    assert rows[0]["score"] == 66000
    assert "74" in rows[0]["selftext"]
    assert rows[0]["url"].endswith("will-x-happen")

def test_polymarket_empty_on_http_error(monkeypatch):
    def _boom(*a, **k): raise mod.httpx.HTTPError("down")
    monkeypatch.setattr(mod.httpx, "get", _boom)
    assert mod.fetch_polymarket("X", limit=5) == []
