"""Unit tests for research.evidence_verdicts — claim adjudication.

The LLM provider is monkeypatched to return a deterministic stance list so the
aggregation, verdict thresholds, and persistence are tested offline.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    from gapmap.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db = db_mod.get_db()
    db["posts"].insert_all([
        {"id": "s1", "title": "offline mode please", "selftext": "need offline",
         "score": 50, "source_type": "reddit"},
        {"id": "s2", "title": "offline would help", "selftext": "want offline",
         "score": 30, "source_type": "reddit"},
        {"id": "s3", "title": "offline support paper", "selftext": "offline feature",
         "score": 20, "source_type": "arxiv"},
        {"id": "c1", "title": "offline mode is useless", "selftext": "never offline",
         "score": 10, "source_type": "reddit"},
    ], pk="id")
    db["topic_posts"].insert_all(
        [{"topic": "t", "post_id": pid} for pid in ("s1", "s2", "s3", "c1")],
        pk=("topic", "post_id"))
    return db


class _FakeProvider:
    def __init__(self, stances):
        self._stances = stances

    def complete(self, prompt, system, max_tokens, temperature):
        return json.dumps(self._stances)


def _patch_provider(monkeypatch, stances):
    import gapmap.analyze.providers.base as base
    monkeypatch.setattr(base, "resolve_provider", lambda p=None: "test")
    monkeypatch.setattr(base, "get_provider", lambda p=None: _FakeProvider(stances))


def test_supported_verdict(db, monkeypatch):
    from gapmap.research import evidence_verdicts
    _patch_provider(monkeypatch, [
        {"id": "s1", "stance": "support"}, {"id": "s2", "stance": "support"},
        {"id": "s3", "stance": "support"}, {"id": "c1", "stance": "contradict"},
    ])
    r = evidence_verdicts.answer("t", "users want offline mode")
    assert r["ok"] and r["verdict"] == "supported"
    assert r["supporting"] == 3 and r["contradicting"] == 1
    # Per-source breakdown captures reddit vs arxiv.
    assert "arxiv" in r["sources_breakdown"]


def test_mixed_verdict(db, monkeypatch):
    from gapmap.research import evidence_verdicts
    _patch_provider(monkeypatch, [
        {"id": "s1", "stance": "support"}, {"id": "s2", "stance": "support"},
        {"id": "s3", "stance": "contradict"}, {"id": "c1", "stance": "contradict"},
    ])
    r = evidence_verdicts.answer("t", "users want offline mode")
    assert r["verdict"] == "mixed"


def test_insufficient_when_few_decisive(db, monkeypatch):
    from gapmap.research import evidence_verdicts
    _patch_provider(monkeypatch, [
        {"id": "s1", "stance": "support"}, {"id": "s2", "stance": "neutral"},
        {"id": "s3", "stance": "neutral"}, {"id": "c1", "stance": "neutral"},
    ])
    r = evidence_verdicts.answer("t", "users want offline mode")
    assert r["verdict"] == "insufficient"


def test_no_matching_evidence(db, monkeypatch):
    from gapmap.research import evidence_verdicts
    _patch_provider(monkeypatch, [])
    r = evidence_verdicts.answer("t", "completely unrelated zxqw topic")
    assert r["ok"] is False and r["verdict"] == "insufficient"


def test_cached_read(db, monkeypatch):
    from gapmap.research import evidence_verdicts
    _patch_provider(monkeypatch, [
        {"id": "s1", "stance": "support"}, {"id": "s2", "stance": "support"},
        {"id": "s3", "stance": "support"},
    ])
    evidence_verdicts.answer("t", "users want offline mode")
    got = evidence_verdicts.get("t")
    assert got["count"] == 1 and got["rows"][0]["verdict"] == "supported"
