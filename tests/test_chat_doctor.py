"""Tests for chat doctor — the topic readiness probe.

Uses a fake DB (injected via diagnose(db=...)) and a monkeypatched palace, so we
exercise the diagnosis logic for each real failure mode without a real corpus.
"""
import pytest

from openreply.research.chat import doctor


class FakeDB:
    def __init__(self, posts=0, posts_text=0, findings=0):
        self.posts, self.posts_text, self.findings = posts, posts_text, findings

    def query(self, sql, params):
        if "JOIN topic_posts" in sql and "title" in sql:
            return [{"n": self.posts_text}]
        if "FROM topic_posts WHERE topic" in sql:
            return [{"n": self.posts}]
        if "graph_nodes" in sql:
            return [{"n": self.findings}]
        return [{"n": 0}]


def _check(report, name):
    return next((c for c in report["checks"] if c["name"] == name), None)


@pytest.fixture(autouse=True)
def _provider_ok(monkeypatch):
    # Make provider resolution succeed by default so we isolate the corpus/palace checks.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)


def _patch_palace(monkeypatch, *, available=True, ready=True, by_topic=None):
    import openreply.retrieval.palace as palace
    monkeypatch.setattr(palace, "is_available", lambda: available)
    monkeypatch.setattr(palace, "is_model_ready", lambda: ready)
    monkeypatch.setattr(palace, "stats", lambda: {"count": sum((by_topic or {}).values()), "by_topic": by_topic or {}})


def test_no_corpus_is_blocked(monkeypatch):
    _patch_palace(monkeypatch, by_topic={})
    rep = doctor.diagnose("ai", db=FakeDB(posts=0))
    assert rep["ok"] is False and rep["verdict"] == "blocked"
    assert _check(rep, "corpus")["ok"] is False
    assert "collect" in _check(rep, "corpus")["fix"].lower()


def test_corpus_but_not_indexed_in_palace(monkeypatch):
    _patch_palace(monkeypatch, by_topic={"ai": 0})
    rep = doctor.diagnose("ai", db=FakeDB(posts=42, posts_text=42, findings=0))
    # Not a hard block (chat still works via SQL), but the indexed check flags it with a fix.
    idx = _check(rep, "palace_indexed")
    assert idx is not None and idx["ok"] is False
    assert "reindex" in idx["fix"].lower()


def test_topic_name_variant_is_auto_resolved(monkeypatch):
    # palace indexed under "Machine Learning"; UI queries "machine learning".
    # Chat now auto-resolves the variant, so the indexed check passes and notes it.
    _patch_palace(monkeypatch, by_topic={"Machine Learning": 30})
    rep = doctor.diagnose("machine learning", db=FakeDB(posts=30, posts_text=30))
    idx = _check(rep, "palace_indexed")
    assert idx is not None and idx["ok"] is True
    assert "Machine Learning" in idx["detail"] and "auto-resolved" in idx["detail"]
    assert _check(rep, "palace_name_match") is None  # no longer a failure


def test_all_good_is_ready(monkeypatch):
    _patch_palace(monkeypatch, by_topic={"ai": 100})
    rep = doctor.diagnose("ai", db=FakeDB(posts=100, posts_text=98, findings=12))
    assert rep["ok"] is True and rep["verdict"] == "ready"
    assert rep["grounding"] == "ok"


def test_no_provider_blocks(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    from openreply.research.chat import llm_dispatch
    monkeypatch.setattr(llm_dispatch, "_auto_detect_provider", lambda: None)
    _patch_palace(monkeypatch, by_topic={"ai": 100})
    rep = doctor.diagnose("ai", db=FakeDB(posts=100, posts_text=100, findings=5))
    prov = _check(rep, "provider")
    assert prov["ok"] is False and rep["ok"] is False


def test_format_report_is_readable(monkeypatch):
    _patch_palace(monkeypatch, by_topic={"ai": 5})
    rep = doctor.diagnose("ai", db=FakeDB(posts=5, posts_text=5))
    out = doctor.format_report(rep)
    assert "chat doctor" in out and "topic: 'ai'" in out
