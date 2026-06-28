"""Unit tests for research.science — paper fetching per painpoint."""
from __future__ import annotations

import pytest

from openreply.research import science as sci_mod


def _fixture_paper(pid: str, title: str, source: str = "pubmed") -> dict:
    return {
        "id": f"{source}_{pid}",
        "source_type": source,
        "title": title,
        "selftext": f"abstract for {title}",
        "author": "Smith et al.",
        "score": 10,
        "url": f"https://example.com/{pid}",
        "created_utc": 1700000000.0,
        "sub": source,
    }


def test_fetch_science_dedupes_by_title(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sci_mod, "fetch_pubmed", lambda q, limit=10: [
        _fixture_paper("1", "Implementation intentions improve focus"),
        _fixture_paper("2", "Pomodoro effects on attention"),
    ])
    monkeypatch.setattr(sci_mod, "fetch_scholar", lambda q, limit=10: [
        # Same title as pubmed result — should be deduped
        _fixture_paper("99", "Implementation intentions improve focus", source="scholar"),
        _fixture_paper("3", "Mindfulness training and focus", source="scholar"),
    ])
    monkeypatch.setattr(sci_mod, "fetch_openalex", lambda q, limit=10: [])

    papers = sci_mod.fetch_science_for_painpoint(
        painpoint_label="can't focus more than 10 minutes",
        jtbd_desired_outcome="two-hour focused block",
        limit=5,
    )

    titles = [p["title"] for p in papers]
    assert "Implementation intentions improve focus" in titles
    assert "Pomodoro effects on attention" in titles
    assert "Mindfulness training and focus" in titles
    assert len(papers) == 3  # dedupe removed the duplicate
    # Each paper has a normalized tier
    for p in papers:
        assert p["tier"] in ("anecdote", "expert", "peer-reviewed", "meta-analysis")


def test_fetch_science_handles_fetcher_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(q, limit=10):
        raise RuntimeError("network down")
    monkeypatch.setattr(sci_mod, "fetch_pubmed", boom)
    monkeypatch.setattr(sci_mod, "fetch_scholar", lambda q, limit=10: [_fixture_paper("1", "ok paper")])
    monkeypatch.setattr(sci_mod, "fetch_openalex", lambda q, limit=10: [])

    papers = sci_mod.fetch_science_for_painpoint(
        painpoint_label="x",
        jtbd_desired_outcome="y",
        limit=5,
    )

    assert len(papers) == 1
    assert papers[0]["title"] == "ok paper"


def test_fetch_science_empty_query_returns_empty() -> None:
    papers = sci_mod.fetch_science_for_painpoint(
        painpoint_label="",
        jtbd_desired_outcome="",
        limit=5,
    )
    assert papers == []
