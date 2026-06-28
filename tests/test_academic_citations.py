"""Tests for the deterministic citation-existence gate.

No network is hit: a fake db supplies post rows and
``openreply.sources.crossref.fetch_by_doi`` is monkeypatched per-case.
"""
from __future__ import annotations

from openreply.research import academic_citations


class FakeDB:
    """Minimal sqlite_utils-style stub.

    ``rows`` maps post_id -> row dict. ``.query(sql, params)`` ignores the SQL
    and returns the matching row (by the first param) as a one-element list, or
    an empty list on miss — mirroring how `verify_citations` selects by id.
    """

    def __init__(self, rows: dict[str, dict]):
        self._rows = rows

    def query(self, sql, params=None):
        pid = (params or [None])[0]
        row = self._rows.get(pid)
        return iter([row] if row is not None else [])


def _doi_row(pid: str, doi: str, title: str = "A Paper") -> dict:
    return {
        "id": pid,
        "source_type": "crossref",
        "title": title,
        "url": f"https://doi.org/{doi}",
        "permalink": f"https://doi.org/{doi}",
    }


def test_doi_resolves_is_verified(monkeypatch):
    monkeypatch.setattr(
        academic_citations.crossref, "fetch_by_doi", lambda doi: {"id": "ok"}
    )
    db = FakeDB({"crossref_10.1234/abc": _doi_row("crossref_10.1234/abc", "10.1234/abc")})

    res = academic_citations.verify_citations(["crossref_10.1234/abc"], db=db)

    assert res["total"] == 1
    assert res["verified"] == 1
    assert res["missing"] == 0
    assert res["blocking"] is False
    assert res["ok"] is True
    c = res["citations"][0]
    assert c["kind"] == "doi"
    assert c["status"] == "verified"
    assert c["identifier"] == "10.1234/abc"


def test_doi_does_not_resolve_is_missing_and_blocking(monkeypatch):
    # Crossref miss → None → fabrication signal.
    monkeypatch.setattr(
        academic_citations.crossref, "fetch_by_doi", lambda doi: None
    )
    db = FakeDB({"crossref_10.9876/xyz": _doi_row("crossref_10.9876/xyz", "10.9876/xyz")})

    res = academic_citations.verify_citations(["crossref_10.9876/xyz"], db=db)

    assert res["missing"] == 1
    assert res["verified"] == 0
    assert res["blocking"] is True
    assert res["ok"] is False
    assert res["citations"][0]["status"] == "missing"


def test_no_identifier_is_unresolvable_not_blocking(monkeypatch):
    # fetch_by_doi should never even be called for a no-identifier row.
    def _boom(doi):  # pragma: no cover - asserts it's not invoked
        raise AssertionError("fetch_by_doi should not be called")

    monkeypatch.setattr(academic_citations.crossref, "fetch_by_doi", _boom)
    db = FakeDB(
        {
            "hn_12345": {
                "id": "hn_12345",
                "source_type": "hackernews",
                "title": "Some discussion",
                "url": "https://news.ycombinator.com/item?id=12345",
                "permalink": "https://news.ycombinator.com/item?id=12345",
            }
        }
    )

    res = academic_citations.verify_citations(["hn_12345"], db=db)

    assert res["unresolvable"] == 1
    assert res["missing"] == 0
    assert res["blocking"] is False
    assert res["ok"] is True
    c = res["citations"][0]
    assert c["kind"] == "none"
    assert c["status"] == "unresolvable"


def test_fetch_raises_is_unresolvable_not_missing(monkeypatch):
    # Network blip during DOI lookup must NOT count as a fabrication.
    def _raise(doi):
        raise RuntimeError("network down")

    monkeypatch.setattr(academic_citations.crossref, "fetch_by_doi", _raise)
    db = FakeDB({"crossref_10.5555/net": _doi_row("crossref_10.5555/net", "10.5555/net")})

    res = academic_citations.verify_citations(["crossref_10.5555/net"], db=db)

    assert res["unresolvable"] == 1
    assert res["missing"] == 0
    assert res["blocking"] is False
    assert res["ok"] is True
    assert res["citations"][0]["status"] == "unresolvable"
    assert res["citations"][0]["kind"] == "doi"


def test_empty_list_is_ok_all_zeros(monkeypatch):
    # No db access and no network should be needed for an empty input.
    monkeypatch.setattr(
        academic_citations.crossref,
        "fetch_by_doi",
        lambda doi: (_ for _ in ()).throw(AssertionError("should not be called")),
    )

    res = academic_citations.verify_citations([])

    assert res["ok"] is True
    assert res["total"] == 0
    assert res["verified"] == 0
    assert res["unresolvable"] == 0
    assert res["missing"] == 0
    assert res["blocking"] is False
    assert res["citations"] == []
    assert isinstance(res["generated_at"], str)
