"""Unit tests for research.solutions — intervention synthesis."""
from __future__ import annotations

import json

import pytest

from reddit_research.research import solutions as sol_mod


class FakeProvider:
    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.last_prompt: str | None = None

    def complete(self, prompt: str, system: str, **kwargs) -> str:
        self.last_prompt = prompt
        return json.dumps(self.payload)


def test_synthesize_solutions_returns_mechanism_and_interventions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = FakeProvider({
        "mechanism": "implementation intentions reduce attention switching cost",
        "interventions": [
            {
                "label": "Write the next 3 actions on paper before opening laptop",
                "confidence_tier": "peer-reviewed",
                "effort": "low",
                "supporting_paper_ids": ["pubmed_111"],
                "rationale": "Gollwitzer 1999 found if-then plans increase follow-through.",
            },
        ],
    })
    monkeypatch.setattr(sol_mod, "get_provider", lambda _name=None: fake)

    result = sol_mod.synthesize_solutions_for_painpoint(
        painpoint_label="can't focus",
        why={"emotions": ["fear"], "jtbd": {"struggling_moment": "x", "anxiety": "y", "desired_outcome": "z"}},
        papers=[
            {"id": "pubmed_111", "title": "Implementation intentions", "selftext": "abstract...", "tier": "peer-reviewed"},
        ],
        provider="fake",
    )

    assert result["mechanism"].startswith("implementation intentions")
    assert len(result["interventions"]) == 1
    assert result["interventions"][0]["confidence_tier"] == "peer-reviewed"
    assert "pubmed_111" in result["interventions"][0]["supporting_paper_ids"]
    assert "can't focus" in fake.last_prompt
    assert "Implementation intentions" in fake.last_prompt


def test_synthesize_solutions_no_papers_returns_skip() -> None:
    result = sol_mod.synthesize_solutions_for_painpoint(
        painpoint_label="x",
        why={"emotions": [], "jtbd": {}},
        papers=[],
        provider="fake",
    )
    assert result == {"_skipped": True, "reason": "no_papers"}


def test_synthesize_solutions_handles_bad_json(monkeypatch: pytest.MonkeyPatch) -> None:
    class BadProvider:
        def complete(self, prompt: str, system: str, **kwargs) -> str:
            return "definitely not json"
    monkeypatch.setattr(sol_mod, "get_provider", lambda _name=None: BadProvider())

    result = sol_mod.synthesize_solutions_for_painpoint(
        painpoint_label="x",
        why={"emotions": [], "jtbd": {}},
        papers=[{"id": "pubmed_1", "title": "t", "selftext": "abs", "tier": "peer-reviewed"}],
        provider="fake",
    )
    assert result.get("_parse_error") is True
