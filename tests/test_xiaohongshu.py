"""xiaohongshu best-effort cookie source."""
from __future__ import annotations

from openreply.sources import xiaohongshu
from openreply.sources.xiaohongshu import fetch_xiaohongshu

_SAMPLE = {
    "data": {
        "items": [
            {"id": "n1", "note_card": {
                "display_title": "Best espresso setup",
                "desc": "my home bar", "user": {"nickname": "barista"},
                "interact_info": {"liked_count": "42", "comment_count": "7"}}},
        ]
    }
}


def test_xhs_no_cookie_returns_empty(monkeypatch):
    monkeypatch.setattr(xiaohongshu._creds, "cookie_header", lambda *a, **k: "")
    assert fetch_xiaohongshu("espresso") == []


def test_xhs_with_cookie_shape(monkeypatch):
    monkeypatch.setattr(xiaohongshu._creds, "cookie_header", lambda *a, **k: "web_session=abc")
    monkeypatch.setattr(xiaohongshu, "_search", lambda q, n, c: _SAMPLE)
    rows = fetch_xiaohongshu("espresso", limit=10)
    assert len(rows) == 1
    r = rows[0]
    assert r["source_type"] == "xiaohongshu"
    assert r["title"] == "Best espresso setup"
    assert r["author"] == "barista"
    assert r["score"] == 42 and r["num_comments"] == 7
    assert r["url"] == "https://www.xiaohongshu.com/explore/n1"


def test_xhs_never_raises(monkeypatch):
    monkeypatch.setattr(xiaohongshu._creds, "cookie_header", lambda *a, **k: "web_session=abc")

    def boom(*a, **k):
        raise RuntimeError("signed header rejected")

    monkeypatch.setattr(xiaohongshu, "_search", boom)
    assert fetch_xiaohongshu("espresso") == []
