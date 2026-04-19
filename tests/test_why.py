"""Unit tests for research.why — emotion + JTBD extraction per painpoint."""
from __future__ import annotations

import json

import pytest

from reddit_research.research import why as why_mod


class FakeProvider:
    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.last_prompt: str | None = None
        self.last_system: str | None = None

    def complete(self, prompt: str, system: str, **kwargs) -> str:
        self.last_prompt = prompt
        self.last_system = system
        return json.dumps(self.payload)


def test_extract_why_returns_emotions_and_jtbd(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeProvider({
        "emotions": ["fear", "sadness"],
        "jtbd": {
            "struggling_moment": "trying to start hard tasks",
            "anxiety": "I'll never finish",
            "desired_outcome": "two-hour focused block",
        },
    })
    monkeypatch.setattr(why_mod, "get_provider", lambda _name=None: fake)

    result = why_mod.extract_why_for_painpoint(
        painpoint_label="can't focus more than 10 minutes",
        evidence_posts=[
            {"id": "p1", "title": "I keep getting distracted", "selftext": "every time I open my laptop..."},
            {"id": "p2", "title": "Focus is impossible", "selftext": "tried pomodoro, failed..."},
        ],
        provider="fake",
    )

    assert result["emotions"] == ["fear", "sadness"]
    assert result["jtbd"]["struggling_moment"] == "trying to start hard tasks"
    assert "can't focus" in fake.last_prompt
    assert "I keep getting distracted" in fake.last_prompt


def test_extract_why_handles_bad_json(monkeypatch: pytest.MonkeyPatch) -> None:
    class BadProvider:
        def complete(self, prompt: str, system: str, **kwargs) -> str:
            return "not valid json {"
    monkeypatch.setattr(why_mod, "get_provider", lambda _name=None: BadProvider())

    result = why_mod.extract_why_for_painpoint(
        painpoint_label="x",
        evidence_posts=[{"id": "p1", "title": "y", "selftext": "z"}],
        provider="fake",
    )

    assert result.get("_parse_error") is True
    assert "_raw" in result


def test_extract_why_empty_evidence_returns_skip() -> None:
    result = why_mod.extract_why_for_painpoint(
        painpoint_label="x",
        evidence_posts=[],
        provider="fake",
    )
    assert result == {"_skipped": True, "reason": "no_evidence"}


def test_extract_why_for_topic_iterates_painpoints(
    monkeypatch: pytest.MonkeyPatch, tmp_path,
) -> None:
    """Per-topic loop: read painpoint nodes from DB, fetch their evidence
    posts, call extract_why_for_painpoint per node, return list."""
    monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", str(tmp_path))
    from reddit_research.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db = db_mod.get_db()

    # Seed: 1 topic, 2 painpoints, 2 posts, evidence edges
    from reddit_research.graph.schema import ensure_graph_schema, make_node_id
    ensure_graph_schema()
    topic = "focus"
    pp1 = make_node_id(topic, "painpoint", "cant-focus")
    pp2 = make_node_id(topic, "painpoint", "too-many-tabs")
    post1 = make_node_id(topic, "post", "p1")
    post2 = make_node_id(topic, "post", "p2")
    db["graph_nodes"].insert_all([
        {"id": pp1, "topic": topic, "kind": "painpoint", "label": "Can't focus", "metadata_json": "{}"},
        {"id": pp2, "topic": topic, "kind": "painpoint", "label": "Too many tabs", "metadata_json": "{}"},
        {"id": post1, "topic": topic, "kind": "post", "label": "p1", "metadata_json": "{}"},
        {"id": post2, "topic": topic, "kind": "post", "label": "p2", "metadata_json": "{}"},
    ], pk="id")
    db["graph_edges"].insert_all([
        {"src": pp1, "dst": post1, "kind": "evidenced_by", "topic": topic, "weight": 1.0, "metadata_json": "{}"},
        {"src": pp2, "dst": post2, "kind": "evidenced_by", "topic": topic, "weight": 1.0, "metadata_json": "{}"},
    ], pk=("src", "dst", "kind"))
    # Seed posts table so evidence lookup finds them
    db["posts"].insert_all([
        {"id": "p1", "sub": "x", "author": "a", "title": "post 1 title", "selftext": "body 1",
         "url": "", "score": 0, "upvote_ratio": None, "num_comments": 0, "created_utc": 0,
         "is_self": 1, "over_18": 0, "flair": None, "permalink": "", "fetched_at": ""},
        {"id": "p2", "sub": "x", "author": "a", "title": "post 2 title", "selftext": "body 2",
         "url": "", "score": 0, "upvote_ratio": None, "num_comments": 0, "created_utc": 0,
         "is_self": 1, "over_18": 0, "flair": None, "permalink": "", "fetched_at": ""},
    ], pk="id", alter=True)

    fake = FakeProvider({"emotions": ["fear"], "jtbd": {"struggling_moment": "x", "anxiety": "y", "desired_outcome": "z"}})
    monkeypatch.setattr(why_mod, "get_provider", lambda _name=None: fake)

    results = why_mod.extract_why_for_topic(topic=topic, provider="fake")
    assert len(results) == 2
    assert {r["painpoint_id"] for r in results} == {pp1, pp2}
    assert all(r["why"]["emotions"] == ["fear"] for r in results)
