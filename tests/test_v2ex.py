"""v2ex public-API source."""
from __future__ import annotations

import httpx

from gapmap.sources import v2ex
from gapmap.sources.v2ex import fetch_v2ex

_SAMPLE = [
    {
        "id": 1,
        "title": "Python async tips",
        "url": "https://v2ex.com/t/1",
        "content": "some body about async python",
        "replies": 3,
        "created": 1700000000,
        "member": {"username": "alice"},
        "node": {"name": "python", "title": "Python"},
    },
    {
        "id": 2,
        "title": "Rust vs Go",
        "url": "https://v2ex.com/t/2",
        "content": "systems languages",
        "replies": 9,
        "node": {"name": "rust", "title": "Rust"},
    },
]


def test_fetch_v2ex_shape(monkeypatch):
    monkeypatch.setattr(v2ex, "polite_get",
                        lambda *a, **k: httpx.Response(200, json=_SAMPLE, request=httpx.Request("GET", "https://x")))
    rows = fetch_v2ex("python", limit=10)
    assert rows
    r = rows[0]
    assert r["source_type"] == "v2ex"
    assert r["title"] == "Python async tips"
    assert r["author"] == "alice"
    assert r["num_comments"] == 3
    assert r["permalink"] is None
    assert r["created_utc"] == 1700000000.0


def test_fetch_v2ex_filters_by_query(monkeypatch):
    monkeypatch.setattr(v2ex, "polite_get",
                        lambda *a, **k: httpx.Response(200, json=_SAMPLE, request=httpx.Request("GET", "https://x")))
    rows = fetch_v2ex("rust", limit=10)
    assert len(rows) == 1 and rows[0]["sub"] == "rust"


def test_fetch_v2ex_never_raises(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("net down")
    monkeypatch.setattr(v2ex, "polite_get", boom)
    assert fetch_v2ex("x") == []
