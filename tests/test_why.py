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
