"""bilibili search-API source."""
from __future__ import annotations

from gapmap.sources import bilibili
from gapmap.sources.bilibili import fetch_bilibili

_SAMPLE = {
    "code": 0,
    "data": {
        "result": [
            {"result_type": "bili_user", "data": [{"uname": "x"}]},
            {"result_type": "video", "data": [
                {"bvid": "BV1xx", "title": 'Async <em class="keyword">python</em> guide',
                 "description": "deep <em>dive</em>", "author": "creator",
                 "play": 12345, "review": 67, "pubdate": 1700000000,
                 "typename": "Tech"},
            ]},
        ]
    },
}


def test_fetch_bilibili_shape(monkeypatch):
    monkeypatch.setattr(bilibili, "_get_json", lambda *a, **k: _SAMPLE)
    rows = fetch_bilibili("python", limit=10)
    assert len(rows) == 1
    r = rows[0]
    assert r["source_type"] == "bilibili"
    assert r["title"] == "Async python guide"      # HTML stripped
    assert r["selftext"] == "deep dive"
    assert r["url"] == "https://www.bilibili.com/video/BV1xx"
    assert r["score"] == 12345 and r["num_comments"] == 67
    assert r["created_utc"] == 1700000000.0


def test_fetch_bilibili_empty_query():
    assert fetch_bilibili("") == []


def test_fetch_bilibili_risk_control_returns_empty(monkeypatch):
    monkeypatch.setattr(bilibili, "_get_json", lambda *a, **k: {"code": -412, "data": {}})
    assert fetch_bilibili("python") == []


def test_fetch_bilibili_never_raises(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("412")
    monkeypatch.setattr(bilibili, "_get_json", boom)
    assert fetch_bilibili("python") == []
