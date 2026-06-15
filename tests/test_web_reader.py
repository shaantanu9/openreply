"""web_reader (Jina Reader) source."""
from __future__ import annotations

import httpx

from gapmap.sources import web_reader
from gapmap.sources.web_reader import fetch_web_reader


def test_web_reader_one_row(monkeypatch):
    monkeypatch.setattr(
        web_reader, "polite_get",
        lambda *a, **k: httpx.Response(200, text="# Title Here\n\nBody text here", request=httpx.Request("GET", "https://x")))
    rows = fetch_web_reader("https://example.com")
    assert len(rows) == 1
    r = rows[0]
    assert r["source_type"] == "web"
    assert r["title"] == "Title Here"
    assert "Body text here" in r["selftext"]
    assert r["url"] == "https://example.com"


def test_web_reader_adds_scheme(monkeypatch):
    monkeypatch.setattr(
        web_reader, "polite_get",
        lambda *a, **k: httpx.Response(200, text="no heading just text", request=httpx.Request("GET", "https://x")))
    rows = fetch_web_reader("example.org/page")
    assert rows[0]["title"] == "https://example.org/page"


def test_web_reader_empty_query_returns_empty():
    assert fetch_web_reader("") == []
    assert fetch_web_reader("   ") == []


def test_web_reader_never_raises(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("net")
    monkeypatch.setattr(web_reader, "polite_get", boom)
    assert fetch_web_reader("https://example.com") == []
