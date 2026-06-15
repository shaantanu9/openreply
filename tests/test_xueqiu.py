"""xueqiu status-search source."""
from __future__ import annotations

from gapmap.sources import xueqiu
from gapmap.sources.xueqiu import fetch_xueqiu

_SAMPLE = {
    "list": [
        {"id": 99, "text": "<p>看好 <b>AI</b> 板块</p>", "target": "/1234/99",
         "created_at": 1700000000000, "reply_count": 5, "like_count": 12,
         "user": {"screen_name": "investor"}},
    ]
}


def test_fetch_xueqiu_shape(monkeypatch):
    monkeypatch.setattr(xueqiu, "_search", lambda q, n: _SAMPLE)
    rows = fetch_xueqiu("AI", limit=10)
    assert len(rows) == 1
    r = rows[0]
    assert r["source_type"] == "xueqiu"
    assert r["selftext"] == "看好 AI 板块"          # HTML stripped
    assert r["author"] == "investor"
    assert r["score"] == 12 and r["num_comments"] == 5
    assert r["created_utc"] == 1700000000.0
    assert r["url"] == "https://xueqiu.com/1234/99"


def test_fetch_xueqiu_empty_query():
    assert fetch_xueqiu("") == []


def test_fetch_xueqiu_never_raises(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("403")
    monkeypatch.setattr(xueqiu, "_search", boom)
    assert fetch_xueqiu("AI") == []
