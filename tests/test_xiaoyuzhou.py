"""xiaoyuzhou episode-metadata source."""
from __future__ import annotations

from gapmap.sources import xiaoyuzhou
from gapmap.sources.xiaoyuzhou import fetch_xiaoyuzhou
from tests._reach_mock import resp

_PAGE = """<html><head>
<title>Ep 42 — Building AI agents</title>
<meta property="og:description" content="We discuss agent memory &amp; tools." />
</head><body>...</body></html>"""


def test_fetch_xiaoyuzhou_shape(monkeypatch):
    monkeypatch.setattr(xiaoyuzhou, "polite_get", lambda *a, **k: resp(text=_PAGE))
    rows = fetch_xiaoyuzhou("https://www.xiaoyuzhoufm.com/episode/abc123")
    assert len(rows) == 1
    r = rows[0]
    assert r["source_type"] == "xiaoyuzhou"
    assert r["title"] == "Ep 42 — Building AI agents"
    assert "agent memory & tools" in r["selftext"]


def test_fetch_xiaoyuzhou_rejects_non_xyz_url():
    assert fetch_xiaoyuzhou("https://example.com/x") == []
    assert fetch_xiaoyuzhou("") == []


def test_fetch_xiaoyuzhou_never_raises(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("net")
    monkeypatch.setattr(xiaoyuzhou, "polite_get", boom)
    assert fetch_xiaoyuzhou("https://www.xiaoyuzhoufm.com/episode/x") == []
