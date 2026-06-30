"""Tests for agent chat (reply/chat.py).

Covers the no-knowledge fallback and the happy path where an agent has a
linked persona, a corpus post, and a graph finding. LLM completion is mocked
so these tests run without a live provider.
"""

from __future__ import annotations

import json


def _fresh_db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core.db import get_db

    get_db.cache_clear()
    return get_db()


def test_no_knowledge_yet(tmp_path, monkeypatch):
    from openreply.reply.agent import create_agent
    from openreply.reply.chat import chat_with_agent

    _fresh_db(tmp_path, monkeypatch)
    a = create_agent(name="Solo", brand="Solo", niche="x")
    r = chat_with_agent("what do we know?", agent_id=a["id"])
    assert r["ok"] is True
    assert "don't have any knowledge yet" in r["answer"]
    assert r["agent_id"] == a["id"]


def test_chat_uses_knowledge_and_sources(monkeypatch, tmp_path):
    _fresh_db(tmp_path, monkeypatch)
    from openreply.persona.store import create_persona
    from openreply.reply.agent import create_agent, link_persona
    from openreply.reply.chat import chat_with_agent

    a = create_agent(name="Acme", brand="Acme", niche="sleep tech")
    db = _fresh_db(tmp_path, monkeypatch)

    # Seed a linked persona with a memory + belief.
    p = create_persona("Sleep Doc", "learn sleep", "sleep")
    pid = p["id"]
    link_persona(a["id"], pid, weight=1.0)
    db["persona_memories"].insert(
        {
            "id": 1,
            "persona_id": pid,
            "source_post_id": "p1",
            "topic": "sleep",
            "lesson": "Consistent schedules improve sleep quality",
            "excerpt": "users report better rest",
            "tags": "[]",
            "importance": 0.9,
            "created_at": "2026-01-01T00:00:00+00:00",
        }
    )
    db["persona_conclusions"].insert(
        {
            "persona_id": pid,
            "statement": "Regular timing beats supplements",
            "evidence_memory_ids": "[1]",
            "confidence": 0.85,
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
    )

    # Seed a corpus post.
    db["posts"].insert(
        {
            "id": "po1",
            "title": "Sleep hygiene tips",
            "selftext": "wind down before bed",
            "source_type": "reddit_free",
            "score": 99,
        }
    )
    db["topic_posts"].insert({"topic": a["topic"], "post_id": "po1"})

    # Seed a graph finding.
    db["graph_nodes"].insert(
        {
            "id": "sleep tech::painpoint::setup friction",
            "topic": a["topic"],
            "kind": "painpoint",
            "label": "setup friction at bedtime",
            "metadata_json": json.dumps({"evidence_count": 3}),
        }
    )

    # Mock the LLM provider.
    captured = {}

    class FakeProvider:
        def complete(self, *, prompt, system=None, max_tokens=None, temperature=None):
            captured["prompt"] = prompt
            captured["system"] = system
            return "Regular timing and a wind-down routine help most people."

    monkeypatch.setattr(
        "openreply.analyze.providers.base.get_provider",
        lambda _name=None: FakeProvider(),
    )

    r = chat_with_agent("what about setup friction and sleep hygiene tips?", agent_id=a["id"])
    assert r["ok"] is True
    assert "Regular timing" in r["answer"]
    assert "Sleep Doc" in captured["prompt"]
    assert "Regular timing beats supplements" in captured["prompt"]
    assert "Sleep hygiene tips" in captured["prompt"]
    assert "setup friction" in captured["prompt"]
    assert any(c["tag"] == "P1" for c in r["citations"]["posts"])
    assert any(c["tag"] == "N1" for c in r["citations"]["nodes"])
