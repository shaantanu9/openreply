"""linkedin public-URL reader (Jina-backed)."""
from __future__ import annotations

from gapmap.sources import linkedin, web_reader
from gapmap.sources.linkedin import fetch_linkedin


def test_fetch_linkedin_reads_public_url(monkeypatch):
    monkeypatch.setattr(web_reader, "_jina_read",
                        lambda url: "# Jane Doe\n\nFounder at Acme")
    rows = fetch_linkedin("https://www.linkedin.com/in/janedoe")
    assert len(rows) == 1
    r = rows[0]
    assert r["source_type"] == "linkedin"
    assert r["title"] == "Jane Doe"


def test_fetch_linkedin_rejects_non_linkedin():
    assert fetch_linkedin("https://example.com") == []
    assert fetch_linkedin("") == []


def test_fetch_linkedin_jina_failure_returns_empty(monkeypatch):
    monkeypatch.setattr(web_reader, "_jina_read", lambda url: None)
    assert fetch_linkedin("https://www.linkedin.com/in/x") == []
