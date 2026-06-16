"""linkedin public-URL reader (Jina-backed)."""
from __future__ import annotations

from gapmap.sources import linkedin, web_reader
from gapmap.sources.linkedin import fetch_linkedin


def _no_cookie(monkeypatch):
    monkeypatch.setattr(linkedin._creds, "cookie_header", lambda *a, **k: "")


def test_fetch_linkedin_reads_public_url(monkeypatch):
    _no_cookie(monkeypatch)
    monkeypatch.setattr(web_reader, "_jina_read",
                        lambda url, cookie=None: "# Jane Doe\n\nFounder at Acme")
    rows = fetch_linkedin("https://www.linkedin.com/in/janedoe")
    assert len(rows) == 1
    r = rows[0]
    assert r["source_type"] == "linkedin"
    assert r["title"] == "Jane Doe"


def test_fetch_linkedin_forwards_cookie(monkeypatch):
    monkeypatch.setattr(linkedin._creds, "cookie_header", lambda *a, **k: "li_at=TOK")
    seen = {}

    def fake_read(url, cookie=None):
        seen["cookie"] = cookie
        return "# Profile\n\nbody"

    monkeypatch.setattr(web_reader, "_jina_read", fake_read)
    rows = fetch_linkedin("https://www.linkedin.com/in/x")
    assert rows and seen["cookie"] == "li_at=TOK"


def test_fetch_linkedin_rejects_non_linkedin():
    assert fetch_linkedin("https://example.com") == []
    assert fetch_linkedin("") == []


def test_fetch_linkedin_jina_failure_returns_empty(monkeypatch):
    _no_cookie(monkeypatch)
    monkeypatch.setattr(web_reader, "_jina_read", lambda url, cookie=None: None)
    assert fetch_linkedin("https://www.linkedin.com/in/x") == []
