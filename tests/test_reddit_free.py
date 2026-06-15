"""reddit_free cookie/proxy source with RSS fallback."""
from __future__ import annotations

from gapmap.sources import reddit_free
from gapmap.sources.reddit_free import fetch_reddit_free

_AUTHED = {
    "data": {"children": [
        {"data": {"id": "abc", "subreddit": "python", "author": "dev",
                  "title": "Async gotchas", "selftext": "body here",
                  "score": 120, "num_comments": 45, "upvote_ratio": 0.97,
                  "permalink": "/r/python/comments/abc/async_gotchas/",
                  "is_self": True, "over_18": False, "created_utc": 1700000000}},
    ]}
}


def test_reddit_free_cookie_path_full_fidelity(monkeypatch):
    monkeypatch.setattr(reddit_free._creds, "cookie_header", lambda *a, **k: "reddit_session=xyz")
    monkeypatch.setattr(reddit_free, "_authed_search", lambda *a, **k: _AUTHED)
    rows = fetch_reddit_free("async", limit=10)
    assert len(rows) == 1
    r = rows[0]
    assert r["source_type"] == "reddit_free"
    assert r["score"] == 120 and r["num_comments"] == 45
    assert r["upvote_ratio"] == 0.97
    assert r["permalink"] == "/r/python/comments/abc/async_gotchas/"


def test_reddit_free_falls_back_to_rss_without_cookie(monkeypatch):
    monkeypatch.setattr(reddit_free._creds, "cookie_header", lambda *a, **k: "")
    called = {}

    def fake_rss(q, sub=None, limit=50):
        called["q"] = q
        return [{"id": "r1", "sub": "python", "source_type": "reddit",
                 "title": "t", "permalink": "/r/python/comments/r1/t/"}]

    monkeypatch.setattr(reddit_free, "public_search", fake_rss)
    rows = fetch_reddit_free("async")
    assert called["q"] == "async"
    assert rows[0]["source_type"] == "reddit_free"   # retagged


def test_reddit_free_cookie_error_falls_back(monkeypatch):
    monkeypatch.setattr(reddit_free._creds, "cookie_header", lambda *a, **k: "reddit_session=xyz")

    def boom(*a, **k):
        raise RuntimeError("403")

    monkeypatch.setattr(reddit_free, "_authed_search", boom)
    monkeypatch.setattr(reddit_free, "public_search",
                        lambda q, sub=None, limit=50: [{"id": "x", "source_type": "reddit"}])
    rows = fetch_reddit_free("async")
    assert rows and rows[0]["source_type"] == "reddit_free"


def test_reddit_free_empty_query():
    assert fetch_reddit_free("") == []
