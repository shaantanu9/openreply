"""CLI tests for `openreply collect-growth`."""
from __future__ import annotations

import json

import pytest
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
