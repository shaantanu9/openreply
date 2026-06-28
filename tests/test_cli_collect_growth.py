"""CLI tests for `openreply collect-growth`."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
from sqlite_utils import Database
from typer.testing import CliRunner

from openreply.cli.main import app


@pytest.fixture(autouse=True)
def _clear_gated_keys(monkeypatch):
    """Make sure credential-gated sources degrade cleanly."""
    for key in (
        "PH_TOKEN", "XAI_API_KEY", "XQUIK_API_KEY",
        "EXA_API_KEY", "YOUTUBE_API_KEY", "TAVILY_API_KEY",
        "SCRAPECREATORS_API_KEY", "BSKY_HANDLE", "BSKY_APP_PASSWORD",
        "GITHUB_TOKEN",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr("openreply.core.credentials.api_key", lambda _s: "")


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Database:
    """Use a fresh temp DB for every test."""
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core import db as db_mod

    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    return db_mod.get_db()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


runner = CliRunner()


def test_collect_growth_opensource_json():
    result = runner.invoke(
        app,
        ["collect-growth", "note app", "--bundle", "opensource", "--limit", "3", "--json"],
    )
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["ok"] is True
    assert data["bundle"] == "opensource"
    for src in ("github", "github_trending", "github_issues"):
        assert src in data["sources"]
        assert isinstance(data["sources"][src], int)


def test_collect_growth_unknown_bundle():
    result = runner.invoke(
        app,
        ["collect-growth", "note app", "--bundle", "foobar", "--json"],
    )
    assert result.exit_code == 2
    assert "unknown bundle" in result.output.lower()


def test_collect_growth_include_filter():
    result = runner.invoke(
        app,
        ["collect-growth", "note app", "--include", "github_trending", "--limit", "2", "--json"],
    )
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert list(data["sources"].keys()) == ["github_trending"]


def test_collect_growth_drafts_generates_rows(db: Database, monkeypatch: pytest.MonkeyPatch):
    """Seed a post for the topic and verify --drafts turns it into a queue row."""
    db["posts"].insert(
        {
            "id": "seed_post_1",
            "sub": "test",
            "source_type": "test",
            "author": "seedbot",
            "title": "Seed note app launch",
            "selftext": "A hot new note-taking app.",
            "url": "https://example.com/seed",
            "score": 999,
            "upvote_ratio": 0.95,
            "num_comments": 12,
            "created_utc": 1_750_000_000.0,
            "is_self": 0,
            "over_18": 0,
            "flair": "",
            "permalink": "https://example.com/seed",
            "fetched_at": _utc_now(),
        },
        pk="id",
        replace=True,
    )
    db["topic_posts"].insert(
        {
            "topic": "note app",
            "post_id": "seed_post_1",
            "source": "test",
            "added_at": _utc_now(),
        },
        pk=("topic", "post_id"),
        replace=True,
    )

    class _FakeProvider:
        def complete(self, *_args: Any, **_kwargs: Any) -> str:
            return "Generated draft from seed post"

    monkeypatch.setattr(
        "openreply.content.drafts.get_provider", lambda _provider=None: _FakeProvider()
    )

    result = runner.invoke(
        app,
        [
            "collect-growth",
            "note app",
            "--bundle",
            "opensource",
            "--limit",
            "1",
            "--drafts",
            "--draft-count",
            "1",
            "--json",
        ],
    )
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["ok"] is True
    assert data["drafts_generated"] == 1
    assert len(data["draft_ids"]) == 1
    assert db["content_queue"].count == 1

    row = db["content_queue"].get(data["draft_ids"][0])
    assert row["topic"] == "note app"
    assert row["source_post_id"] == "seed_post_1"
    assert row["body"] == "Generated draft from seed post"
