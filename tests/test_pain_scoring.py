"""Unit tests for research.pain_scoring — the 0-100 pain score per gap.

Verifies the scoring math (frequency × intensity × recency), persistence to
``gap_scores``, the LLM-free read path, and graceful handling of empty input.
The painpoint extractor (LLM) is monkeypatched so the test is deterministic
and offline.
"""
from __future__ import annotations

import time
from pathlib import Path

import pytest


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    # Pin weights + half-life so the math is deterministic regardless of env.
    monkeypatch.setenv("PAIN_W_FREQ", "0.40")
    monkeypatch.setenv("PAIN_W_INTENSITY", "0.35")
    monkeypatch.setenv("PAIN_W_RECENCY", "0.25")
    monkeypatch.setenv("PAIN_RECENCY_HALFLIFE_DAYS", "90")
    from openreply.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db = db_mod.get_db()
    # Seed two posts: one very recent + high engagement, one old + low.
    now = time.time()
    db["posts"].insert_all([
        {"id": "fresh1", "title": "p1", "score": 999, "num_comments": 1,
         "created_utc": now - 86400, "source_type": "reddit"},      # 1 day old
        {"id": "old1", "title": "p2", "score": 0, "num_comments": 0,
         "created_utc": now - 86400 * 365, "source_type": "reddit"},  # 1 yr old
    ], pk="id")
    return db


def _fake_find_gaps(painpoints):
    def _inner(topic, **kwargs):
        return {"topic": topic, "provider": "test", "corpus_size": 2,
                "painpoints": painpoints}
    return _inner


def test_score_gaps_ranks_and_persists(db, monkeypatch):
    from openreply.research import pain_scoring
    pains = [
        {"painpoint": "High freq recent", "severity": "high", "frequency": 10,
         "evidence": "x", "example_post_ids": ["fresh1"]},
        {"painpoint": "Low freq old", "severity": "low", "frequency": 1,
         "evidence": "y", "example_post_ids": ["old1"]},
    ]
    monkeypatch.setattr(pain_scoring, "find_gaps", _fake_find_gaps(pains), raising=False)
    # find_gaps is imported inside score_gaps via `from .gaps import find_gaps`,
    # so patch the source module too.
    import openreply.research.gaps as gaps_mod
    monkeypatch.setattr(gaps_mod, "find_gaps", _fake_find_gaps(pains))

    r = pain_scoring.score_gaps("t1")
    assert r["ok"] is True
    assert r["scored"] == 2
    rows = r["rows"]
    # The high-frequency, recent, high-severity gap must outrank the other.
    assert rows[0]["title"] == "High freq recent"
    assert rows[0]["pain_score"] > rows[1]["pain_score"]
    # Score is on a 0-100 scale.
    assert 0 <= rows[1]["pain_score"] <= 100
    assert rows[0]["pain_score"] <= 100


def test_recency_decay_recent_beats_old(db, monkeypatch):
    """Same frequency + severity, only recency differs → recent wins."""
    from openreply.research import pain_scoring
    pains = [
        {"painpoint": "Recent", "severity": "medium", "frequency": 5,
         "example_post_ids": ["fresh1"]},
        {"painpoint": "Stale", "severity": "medium", "frequency": 5,
         "example_post_ids": ["old1"]},
    ]
    import openreply.research.gaps as gaps_mod
    monkeypatch.setattr(gaps_mod, "find_gaps", _fake_find_gaps(pains))
    r = pain_scoring.score_gaps("t2")
    by_title = {x["title"]: x for x in r["rows"]}
    assert by_title["Recent"]["recency"] > by_title["Stale"]["recency"]
    assert by_title["Recent"]["pain_score"] > by_title["Stale"]["pain_score"]


def test_read_path_returns_cache(db, monkeypatch):
    from openreply.research import pain_scoring
    pains = [{"painpoint": "Only one", "severity": "high", "frequency": 3,
              "example_post_ids": ["fresh1"]}]
    import openreply.research.gaps as gaps_mod
    monkeypatch.setattr(gaps_mod, "find_gaps", _fake_find_gaps(pains))
    pain_scoring.score_gaps("t3")
    got = pain_scoring.get("t3")
    assert got["ok"] and got["count"] == 1
    assert got["rows"][0]["title"] == "Only one"
    assert got["rows"][0]["sample_post_ids"] == ["fresh1"]


def test_empty_corpus_is_graceful(db, monkeypatch):
    from openreply.research import pain_scoring
    import openreply.research.gaps as gaps_mod
    monkeypatch.setattr(gaps_mod, "find_gaps",
                        lambda topic, **kw: {"topic": topic, "painpoints": [],
                                             "error": "No corpus"})
    r = pain_scoring.score_gaps("empty")
    assert r["ok"] is False
    # Read path on an unknown topic returns an empty, ok result (no crash).
    assert pain_scoring.get("empty")["count"] == 0
