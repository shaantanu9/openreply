"""Unit-tests for the yt-dlp overlay helpers.

These tests DO NOT hit PyPI or run pip — everything is stubbed through
monkeypatch so the suite stays fast + hermetic.
"""
from __future__ import annotations

import json
import sys


def test_is_newer_semantic_compare():
    from gapmap.transcribe.ytdlp_client import _is_newer
    assert _is_newer("2026.4.20", "2026.4.19") is True
    assert _is_newer("2026.4.19", "2026.4.20") is False
    assert _is_newer("2026.4.19", "2026.4.19") is False
    # yt-dlp uses calver with 3 components; a missing third field sorts below.
    assert _is_newer("2026.5.0", "2026.4.99") is True


def test_overlay_dir_uses_data_root_env(tmp_path, monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    from gapmap.transcribe.ytdlp_client import overlay_dir
    assert overlay_dir() == tmp_path / "ytdlp-overlay"


def test_cooldown_skips_update(tmp_path, monkeypatch):
    """If the .last-check stamp is fresh we return skipped:cooldown."""
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    from gapmap.transcribe.ytdlp_client import (
        ensure_latest_ytdlp,
        overlay_dir,
    )
    od = overlay_dir()
    od.mkdir(parents=True, exist_ok=True)
    (od / ".last-check").touch()   # mtime = now → inside 24h window

    # PyPI must not be touched.
    import urllib.request as ur
    def _boom(*_a, **_k):
        raise AssertionError("should not contact PyPI when cooldown is active")
    monkeypatch.setattr(ur, "urlopen", _boom)

    result = ensure_latest_ytdlp()
    assert result["ok"] is True
    assert result.get("skipped") is True
    assert result.get("reason") == "cooldown"


def test_force_bypasses_cooldown_but_handles_pypi_down(tmp_path, monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    from gapmap.transcribe import ytdlp_client as mod

    # Fresh stamp — would normally skip.
    od = mod.overlay_dir()
    od.mkdir(parents=True, exist_ok=True)
    (od / ".last-check").touch()

    # Simulate PyPI unreachable.
    monkeypatch.setattr(mod, "_pypi_latest_stable", lambda *_: None)

    result = mod.ensure_latest_ytdlp(force=True)
    assert result["ok"] is False
    assert result["reason"] == "pypi_unreachable"


def test_no_update_needed_stamps_and_returns(tmp_path, monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    from gapmap.transcribe import ytdlp_client as mod

    monkeypatch.setattr(mod, "ytdlp_current_version", lambda: "2026.5.1")
    monkeypatch.setattr(mod, "_pypi_latest_stable", lambda *_: "2026.5.0")

    result = mod.ensure_latest_ytdlp(force=True)
    assert result["ok"] is True
    assert result["updated"] is False
    assert result["latest"] == "2026.5.0"


def test_overlay_injected_first_on_sys_path(tmp_path, monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    from gapmap.transcribe.ytdlp_client import (
        _inject_overlay_to_path,
        overlay_dir,
    )
    # Clean any prior injection.
    od = str(overlay_dir())
    sys.path = [p for p in sys.path if p != od]
    _inject_overlay_to_path()
    assert sys.path[0] == od
    # Idempotent — calling twice doesn't add a duplicate.
    _inject_overlay_to_path()
    assert sys.path.count(od) == 1
