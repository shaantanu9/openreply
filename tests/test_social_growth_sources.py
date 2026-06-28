"""Growth-source bundle tests (social + open-source + web).

These tests only verify wiring and graceful degradation without credentials —
no live network calls are required.
"""
from __future__ import annotations

import os

import pytest

from openreply.sources.collect_adapter import (
    CONTENT_GROWTH_SOURCES,
    OPEN_SOURCE_GROWTH_SOURCES,
    SOCIAL_GROWTH_SOURCES,
    SOURCES,
    WEB_GROWTH_SOURCES,
    _call_source,
    run_content_growth,
    run_opensource_growth,
    run_social_growth,
    run_web_growth,
)


@pytest.fixture(autouse=True)
def _clear_gated_keys(monkeypatch):
    """Make sure key-gated sources degrade cleanly."""
    for key in (
        "PH_TOKEN", "XAI_API_KEY", "XQUIK_API_KEY",
        "EXA_API_KEY", "YOUTUBE_API_KEY", "TAVILY_API_KEY",
        "SCRAPECREATORS_API_KEY", "BSKY_HANDLE", "BSKY_APP_PASSWORD",
        "GITHUB_TOKEN",
    ):
        monkeypatch.delenv(key, raising=False)
    # Prevent any stored credential from picking up a real key.
    monkeypatch.setattr("openreply.core.credentials.api_key", lambda _s: "")


def test_growth_sources_are_registered():
    for src in CONTENT_GROWTH_SOURCES:
        assert src in SOURCES, f"{src} missing from SOURCES"
        assert callable(SOURCES[src]), f"{src} is not callable"


def test_call_source_returns_int_for_free_sources():
    # These sources need no credentials and should return 0 for a nonsense query.
    for src in ("hn", "devto", "lemmy", "gnews", "duckduckgo", "github_trending"):
        assert src in SOURCES
        result = _call_source(src, "xyz_nonsense_12345", 5)
        assert isinstance(result, int), f"{src} returned {type(result)}"


def test_run_social_growth_runs_all_sources():
    results = run_social_growth("xyz_nonsense_12345", limit=3, max_workers=4)
    for src in SOCIAL_GROWTH_SOURCES:
        assert src in results, f"{src} missing from results"
        assert isinstance(results[src], int)


def test_run_opensource_growth_runs_all_sources():
    results = run_opensource_growth("xyz_nonsense_12345", limit=3, max_workers=2)
    for src in OPEN_SOURCE_GROWTH_SOURCES:
        assert src in results, f"{src} missing from results"
        assert isinstance(results[src], int)


def test_run_web_growth_runs_all_sources():
    results = run_web_growth("xyz_nonsense_12345", limit=3, max_workers=2)
    for src in WEB_GROWTH_SOURCES:
        assert src in results, f"{src} missing from results"
        assert isinstance(results[src], int)


def test_run_content_growth_runs_all_sources():
    results = run_content_growth("xyz_nonsense_12345", limit=3, max_workers=4)
    for src in CONTENT_GROWTH_SOURCES:
        assert src in results, f"{src} missing from results"
        assert isinstance(results[src], int)
