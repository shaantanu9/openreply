"""Unit tests for the cited paper-Q&A core helpers (`research.paper_chat`).

Covers the deterministic, LLM-free parts: author/year formatting, the
noise-section filter, citation numbering in `_build_context` (one citation per
paper, sections aggregated, numbered by first appearance), the Sources block,
and the no-knowledge guidance message.
"""
from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENREPLY_SKIP_PALACE", "1")
    from openreply.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db = db_mod.get_db()
    # 2 papers with known author/year/url.
    db["posts"].insert(
        {"id": "arxiv_a", "title": "Alpha study", "author": "Smith, John; Doe, Jane",
         "created_utc": 1_600_000_000, "url": "https://x/a", "source_type": "arxiv"},
        pk="id", alter=True,
    )
    db["posts"].insert(
        {"id": "arxiv_b", "title": "Beta study", "author": "Lee",
         "created_utc": 1_700_000_000, "url": "https://x/b", "source_type": "arxiv"},
        pk="id", alter=True,
    )
    return db


# ─── no-DB pure helpers ──────────────────────────────────────────────────────
def test_short_author() -> None:
    from openreply.research.paper_chat import _short_author
    assert _short_author("Smith, John") == "Smith"
    assert _short_author("Smith, John; Doe, Jane") == "Smith et al."
    assert _short_author("Jane Doe") == "Doe"
    assert _short_author("[deleted]") == ""
    assert _short_author(None) == ""


def test_year_of() -> None:
    from openreply.research.paper_chat import _year_of
    assert _year_of(1_600_000_000) == "2020"
    assert _year_of(0) == ""
    assert _year_of(None) == ""
    assert _year_of("not a ts") == ""


def test_noise_sections_membership() -> None:
    from openreply.research import paper_chat as pc
    assert "references" in pc._NOISE_SECTIONS
    assert "acknowledgments" in pc._NOISE_SECTIONS
    assert "results" not in pc._NOISE_SECTIONS


def test_no_knowledge_message() -> None:
    from openreply.research.paper_chat import _no_knowledge_message
    base = _no_knowledge_message(None)
    assert "paper knowledge" in base.lower()
    assert "retrieval note: x" in _no_knowledge_message("x")


def test_format_sources_block() -> None:
    from openreply.research.paper_chat import _format_sources_block
    assert _format_sources_block([]) == ""
    block = _format_sources_block([
        {"n": 1, "title": "Alpha study", "author": "Smith et al.", "year": "2020",
         "url": "https://x/a", "sections": ["results", "methods"]},
    ])
    assert "## Sources" in block
    assert "[1] [Alpha study](https://x/a)" in block
    assert "§results" in block and "Smith et al." in block


# ─── _build_context (needs DB for title/author/year lookup) ──────────────────
def test_build_context_numbers_papers_and_aggregates_sections(db) -> None:
    from openreply.research.paper_chat import _build_context
    chunks = [
        {"post_id": "arxiv_a", "section": "results", "text": "alpha rose in results"},
        {"post_id": "arxiv_b", "section": "methods", "text": "beta used a method"},
        {"post_id": "arxiv_a", "section": "discussion", "text": "alpha discussion"},
    ]
    context, citations = _build_context(chunks)
    # One citation per distinct paper, numbered by first appearance.
    assert len(citations) == 2
    a = next(c for c in citations if c["post_id"] == "arxiv_a")
    b = next(c for c in citations if c["post_id"] == "arxiv_b")
    assert a["n"] == 1 and b["n"] == 2
    # arxiv_a contributed two sections.
    assert set(a["sections"]) == {"results", "discussion"}
    assert a["author"] == "Smith et al." and a["year"] == "2020"
    assert b["author"] == "Lee"
    # Context references the bracket numbers + section tags.
    assert "[1]" in context and "[2]" in context
    assert "§results" in context and "§methods" in context


def test_build_context_empty() -> None:
    from openreply.research.paper_chat import _build_context
    context, citations = _build_context([])
    assert context == "" and citations == []
