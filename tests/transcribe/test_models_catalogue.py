"""Sanity-checks on the Whisper model catalogue + default-tier resolution."""
from __future__ import annotations

from pathlib import Path


def test_catalogue_has_every_expected_tier():
    from reddit_research.transcribe.models import MODELS, DEFAULT_TIER

    assert DEFAULT_TIER in MODELS
    expected_tiers = {"tiny.en", "base.en", "small.en", "medium.en", "large-v3"}
    assert set(MODELS) == expected_tiers
    for tier, info in MODELS.items():
        assert info["size_mb"] > 0, tier
        assert info["rtf"] > 0, tier
        assert info["repo"].startswith("Systran/faster-whisper-"), tier


def test_default_tier_falls_back_to_default_when_nothing_installed(tmp_path, monkeypatch):
    """With no models on disk, default_tier() returns DEFAULT_TIER."""
    monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", str(tmp_path))
    # Isolate from externally-discoverable models on the test runner —
    # list_installed() probes HF cache + GAPMAP_WHISPER_MODELS_DIR too.
    # Other tests in this file already isolate the same way.
    monkeypatch.setenv("HF_HUB_CACHE", str(tmp_path / "_hf_empty"))
    monkeypatch.delenv("GAPMAP_WHISPER_MODELS_DIR", raising=False)
    from reddit_research.transcribe.models import DEFAULT_TIER, default_tier
    assert default_tier() == DEFAULT_TIER


def _stub_model(root: Path, tier: str) -> None:
    """Make an installable-looking tier dir (has model.bin + tokenizer.json)."""
    d = root / tier
    d.mkdir(parents=True, exist_ok=True)
    (d / "model.bin").write_bytes(b"\x00" * 16)
    (d / "tokenizer.json").write_text("{}")


def test_default_tier_reads_marker_file(tmp_path, monkeypatch):
    """A .default marker trumps the built-in DEFAULT_TIER when the tier is installed."""
    monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("HF_HUB_CACHE", str(tmp_path / "_hf_empty"))
    monkeypatch.delenv("GAPMAP_WHISPER_MODELS_DIR", raising=False)
    from reddit_research.transcribe.models import (
        default_tier,
        models_root,
        set_default_tier,
    )
    tier = "base.en"
    _stub_model(models_root(), tier)
    set_default_tier(tier)
    assert default_tier() == tier


def test_default_tier_ignores_stale_marker(tmp_path, monkeypatch):
    """If the marker references an uninstalled tier we fall back to DEFAULT_TIER."""
    monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("HF_HUB_CACHE", str(tmp_path / "_hf_empty"))
    monkeypatch.delenv("GAPMAP_WHISPER_MODELS_DIR", raising=False)
    from reddit_research.transcribe.models import (
        DEFAULT_TIER,
        default_tier,
        models_root,
    )
    root = models_root()
    root.mkdir(parents=True, exist_ok=True)
    (root / ".default").write_text("medium.en")  # tier dir missing
    assert default_tier() == DEFAULT_TIER


def test_catalogue_marks_installed(tmp_path, monkeypatch):
    monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("HF_HUB_CACHE", str(tmp_path / "_hf_empty"))
    monkeypatch.delenv("GAPMAP_WHISPER_MODELS_DIR", raising=False)
    from reddit_research.transcribe.models import catalogue, models_root
    _stub_model(models_root(), "base.en")
    rows = {r["tier"]: r for r in catalogue()}
    assert rows["base.en"]["installed"] is True
    assert rows["base.en"]["source"] == "app"
    assert rows["tiny.en"]["installed"] is False
    assert rows["tiny.en"]["source"] is None
