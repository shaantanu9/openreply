"""Tests for content draft generation from growth posts."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from sqlite_utils import Database

from openreply.content.drafts import generate_drafts_from_posts


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Database:
    """Use a fresh temp DB for every test."""
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core import db as db_mod

    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    return db_mod.get_db()


@pytest.fixture
def fake_provider(monkeypatch: pytest.MonkeyPatch):
    """Patch LLM provider to return deterministic text."""

    class _Provider:
        def __init__(self, text: str = "Mocked draft body"):
            self.text = text

        def complete(self, *_, **__) -> str:
            return self.text

    def _make_provider(text: str):
        def _get_provider(_provider=None):
            return _Provider(text)

        return _get_provider

    def _patch(text: str):
        monkeypatch.setattr(
            "openreply.content.drafts.get_provider",
            _make_provider(text),
        )

    return _patch


@pytest.fixture
def sample_posts() -> list[dict[str, Any]]:
    return [
        {
            "id": "post_a",
            "title": "Alpha note-taking tool",
            "selftext": "Details about alpha.",
            "url": "https://example.com/a",
            "source_type": "hn",
            "score": 100,
            "author": "alice",
            "flair": "show",
            "sub": "hackernews",
        },
        {
            "id": "post_b",
            "title": "Beta productivity app",
            "selftext": "Details about beta.",
            "url": "https://example.com/b",
            "source_type": "reddit_free",
            "score": 50,
            "author": "bob",
            "flair": None,
            "sub": "productivity",
        },
        {
            "id": "post_c",
            "title": "Gamma open-source project",
            "selftext": "Details about gamma.",
            "url": "https://example.com/c",
            "source_type": "github",
            "score": 200,
            "author": "carol",
            "flair": None,
            "sub": "github",
        },
    ]


def test_generate_drafts_persists_to_content_queue(
    db: Database, fake_provider, sample_posts
):
    fake_provider("Draft body here")
    drafts = generate_drafts_from_posts(
        topic="note app",
        posts=sample_posts,
        count=2,
        platform="x",
        content_type="post",
    )

    assert len(drafts) == 2
    assert db["content_queue"].count == 2

    for draft in drafts:
        assert draft["status"] == "draft"
        assert draft["platform"] == "x"
        assert draft["content_type"] == "post"
        assert draft["topic"] == "note app"
        assert draft["body"] == "Draft body here"
        assert draft["source_post_id"] in {"post_c", "post_a"}
        assert draft["id"]


def test_generate_drafts_preview_no_persistence(
    db: Database, fake_provider, sample_posts
):
    fake_provider("Preview only")
    drafts = generate_drafts_from_posts(
        topic="note app",
        posts=sample_posts,
        count=1,
        platform="linkedin",
        content_type="article",
        persist=False,
    )

    assert len(drafts) == 1
    assert db["content_queue"].count == 0
    assert drafts[0]["platform"] == "linkedin"
    assert drafts[0]["content_type"] == "article"


def test_generate_drafts_unknown_content_type_returns_empty(
    db: Database, fake_provider, sample_posts
):
    fake_provider("should not be used")
    drafts = generate_drafts_from_posts(
        topic="note app",
        posts=sample_posts,
        count=5,
        content_type="newsletter",
    )
    assert drafts == []
    assert db["content_queue"].count == 0


def test_generate_drafts_sorts_by_score(
    db: Database, fake_provider, sample_posts
):
    # Return the source title so we can verify which posts were selected.
    fake_provider("")

    # Patch provider.complete to echo the source title from the prompt.
    selected_titles: list[str] = []

    def _echo_title(*args, **kwargs) -> str:
        # args[0] is the prompt text; extract the title line.
        prompt = args[0]
        for line in prompt.splitlines():
            if line.startswith("Title:"):
                title = line.replace("Title:", "").strip()
                selected_titles.append(title)
                return title
        return "fallback"

    monkeypatch = pytest.MonkeyPatch()

    class _Provider:
        def complete(self, *args, **kwargs) -> str:
            return _echo_title(*args, **kwargs)

    monkeypatch.setattr("openreply.content.drafts.get_provider", lambda _p=None: _Provider())

    drafts = generate_drafts_from_posts(
        topic="note app",
        posts=sample_posts,
        count=2,
        platform="x",
        content_type="post",
    )
    monkeypatch.undo()

    assert [d["title"] for d in drafts] == selected_titles
    assert selected_titles == ["Gamma open-source project", "Alpha note-taking tool"]


def test_generate_drafts_provider_failure_is_graceful(
    db: Database, sample_posts, monkeypatch: pytest.MonkeyPatch
):
    class _BadProvider:
        def complete(self, *_, **__) -> str:
            raise RuntimeError("provider down")

    monkeypatch.setattr(
        "openreply.content.drafts.get_provider", lambda _p=None: _BadProvider()
    )
    drafts = generate_drafts_from_posts(
        topic="note app", posts=sample_posts, count=3
    )
    assert drafts == []
    assert db["content_queue"].count == 0


def test_generate_drafts_metadata_json_roundtrip(
    db: Database, fake_provider, sample_posts
):
    fake_provider("body")
    drafts = generate_drafts_from_posts(
        topic="note app", posts=sample_posts, count=1
    )
    meta = json.loads(drafts[0]["metadata_json"])
    assert meta["author"] == "carol"
    assert meta["score"] == 200
    assert meta["flair"] is None
    assert meta["sub"] == "github"
