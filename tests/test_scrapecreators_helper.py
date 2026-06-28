import openreply.sources._scrapecreators as sc

def test_key_missing_returns_none(monkeypatch):
    monkeypatch.delenv("SCRAPECREATORS_API_KEY", raising=False)
    assert sc.api_key() is None

def test_error_row_shape():
    row = sc.error_row("tiktok")
    assert "_error" in row and "SCRAPECREATORS_API_KEY" in row["_error"]

def test_get_passes_key_header(monkeypatch):
    captured = {}
    monkeypatch.setenv("SCRAPECREATORS_API_KEY", "k1")
    class _R:
        status_code = 200
        def json(self): return {"ok": True}
        def raise_for_status(self): pass
    def _fake_get(url, **kw):
        captured.update(kw); captured["url"] = url
        return _R()
    monkeypatch.setattr(sc.httpx, "get", _fake_get)
    out = sc.get("/v1/tiktok/search", params={"query": "x"})
    assert out == {"ok": True}
    assert captured["headers"]["x-api-key"] == "k1"
