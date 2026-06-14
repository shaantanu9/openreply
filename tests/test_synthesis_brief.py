"""Task 3 — synthesize_insights picks up the clarified-brief preamble.

Strategy: mock resolve_provider, _select_corpus, and get_provider so we can
capture the prompt string that would be sent to the LLM without a real key.
Assert that the captured prompt starts with the brief preamble when one is set,
and that it is absent when none is set.
"""
from __future__ import annotations

import importlib
import tempfile
from unittest.mock import MagicMock


# ─── helpers ──────────────────────────────────────────────────────────────────

def _setup(monkeypatch, tmp_path):
    """Fresh isolated DB + reload all relevant modules."""
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    import gapmap.core.db as db_mod
    importlib.reload(db_mod)
    db_mod.get_db.cache_clear()
    db_mod.get_db()

    import gapmap.research.brief as br_mod
    importlib.reload(br_mod)

    return db_mod, br_mod


def _make_fake_row() -> dict:
    return {
        "id": "p1", "title": "Sample post", "selftext": "Some pain point text",
        "score": 10, "num_comments": 5, "source_type": "reddit",
        "subreddit": "test", "url": "https://reddit.com/r/test/p1",
        "created_utc": "2024-01-01T00:00:00Z",
    }


# ─── tests ────────────────────────────────────────────────────────────────────

def test_brief_preamble_in_synthesis_prompt(monkeypatch, tmp_path):
    """When a brief is set, synthesize_insights prepends the preamble to user_prompt."""
    db_mod, br_mod = _setup(monkeypatch, tmp_path)

    # Set a brief with a distinctive goal string.
    br_mod.set_brief("mynotes", goal="find gaps in note-taking apps", constraints="", success="", audience="")

    captured: list[str] = []

    class FakeProvider:
        def complete(self, prompt="", system="", **kwargs):
            captured.append(prompt)
            # Return minimal valid JSON so parse path doesn't crash.
            return '{"findings": []}'

    import gapmap.research.insights as ins_mod
    importlib.reload(ins_mod)

    # get_provider is imported lazily inside the function; patch on the base module.
    import gapmap.analyze.providers.base as base_mod
    monkeypatch.setattr(base_mod, "get_provider", lambda name=None: FakeProvider())

    # Patch resolve_provider to return a dummy name.
    monkeypatch.setattr(ins_mod, "resolve_provider", lambda p=None: "fake")
    # Patch _select_corpus to return one fake row so we reach the prompt build.
    monkeypatch.setattr(ins_mod, "_select_corpus", lambda topic, min_score=0: [_make_fake_row()])

    ins_mod.synthesize_insights(topic="mynotes", provider="fake", persist=False)

    assert captured, "FakeProvider.complete() was never called — prompt was not sent"
    prompt_sent = captured[0]
    assert "find gaps in note-taking apps" in prompt_sent, (
        f"Expected brief goal in prompt; got prefix: {prompt_sent[:300]!r}"
    )
    assert "Research brief" in prompt_sent, (
        f"Expected 'Research brief' header in prompt; got: {prompt_sent[:300]!r}"
    )


def test_no_brief_no_preamble(monkeypatch, tmp_path):
    """When no brief is set, synthesize_insights does NOT prepend the preamble."""
    db_mod, br_mod = _setup(monkeypatch, tmp_path)
    # No set_brief call — topic has no brief.

    captured: list[str] = []

    class FakeProvider:
        def complete(self, prompt="", system="", **kwargs):
            captured.append(prompt)
            return '{"findings": []}'

    import gapmap.research.insights as ins_mod
    importlib.reload(ins_mod)

    import gapmap.analyze.providers.base as base_mod
    monkeypatch.setattr(base_mod, "get_provider", lambda name=None: FakeProvider())
    monkeypatch.setattr(ins_mod, "resolve_provider", lambda p=None: "fake")
    monkeypatch.setattr(ins_mod, "_select_corpus", lambda topic, min_score=0: [_make_fake_row()])

    ins_mod.synthesize_insights(topic="nobrief", provider="fake", persist=False)

    assert captured, "FakeProvider.complete() was never called"
    assert "Research brief" not in captured[0], (
        "Brief preamble appeared even though no brief was set"
    )
