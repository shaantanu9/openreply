import openreply.sources.truthsocial as mod

class _FakeResp:
    def __init__(self, payload, status=200):
        self._payload, self.status_code = payload, status
    def json(self): return self._payload
    def raise_for_status(self): pass

_FIXTURE = {"statuses": [{
    "id": "111",
    "content": "<p>Big news <br/>today</p>",
    "url": "https://truthsocial.com/@x/posts/111",
    "favourites_count": 42,
    "reblogs_count": 3,
    "replies_count": 7,
    "created_at": "2026-06-01T12:00:00.000Z",
    "account": {"acct": "realX", "display_name": "Real X"},
}]}

def test_truthsocial_missing_token_skips(monkeypatch):
    monkeypatch.delenv("TRUTHSOCIAL_TOKEN", raising=False)
    rows = mod.fetch_truthsocial("news", limit=5)
    assert len(rows) == 1 and "_error" in rows[0]

def test_truthsocial_maps_rows(monkeypatch):
    monkeypatch.setenv("TRUTHSOCIAL_TOKEN", "tok")
    monkeypatch.setattr(mod.httpx, "get", lambda *a, **k: _FakeResp(_FIXTURE))
    rows = mod.fetch_truthsocial("news", limit=5)
    assert rows[0]["source_type"] == "truthsocial"
    assert rows[0]["score"] == 42
    assert rows[0]["author"] == "realX"
    assert "Big news" in rows[0]["selftext"] and "<p>" not in rows[0]["selftext"]
