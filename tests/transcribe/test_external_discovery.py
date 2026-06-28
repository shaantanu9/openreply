"""External Whisper install discovery + download short-circuit."""
from __future__ import annotations

from pathlib import Path


def _stub_tier(d: Path, tier: str) -> Path:
    """Create a fake model dir with the two required files so it's treated
    as a valid install. Returns the directory path."""
    d.mkdir(parents=True, exist_ok=True)
    (d / "model.bin").write_bytes(b"\x00" * 16)
    (d / "tokenizer.json").write_text("{}")
    return d


def test_discover_finds_hf_hub_snapshot(tmp_path, monkeypatch):
    """A tier present under the HuggingFace hub cache gets detected as
    ``source='hf_hub'`` with the path pointing at the snapshot dir."""
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path / "data"))
    hf_root = tmp_path / "hf"
    monkeypatch.setenv("HF_HUB_CACHE", str(hf_root))
    monkeypatch.delenv("OPENREPLY_WHISPER_MODELS_DIR", raising=False)

    snap = hf_root / "models--Systran--faster-whisper-small.en" / "snapshots" / "abc123"
    _stub_tier(snap, "small.en")
    (hf_root / "models--Systran--faster-whisper-small.en" / "refs").mkdir(parents=True, exist_ok=True)
    (hf_root / "models--Systran--faster-whisper-small.en" / "refs" / "main").write_text("abc123")

    from openreply.transcribe.models import discover_installed_external

    rows = discover_installed_external()
    by_tier = {r["tier"]: r for r in rows}
    assert "small.en" in by_tier, by_tier
    assert by_tier["small.en"]["source"] == "hf_hub"
    assert Path(by_tier["small.en"]["path"]).resolve() == snap.resolve()


def test_env_override_takes_priority(tmp_path, monkeypatch):
    """OPENREPLY_WHISPER_MODELS_DIR beats the HF cache when both have the tier."""
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path / "data"))

    custom = tmp_path / "custom-models"
    _stub_tier(custom / "medium.en", "medium.en")
    monkeypatch.setenv("OPENREPLY_WHISPER_MODELS_DIR", str(custom))

    # Also populate an HF snapshot to prove env wins.
    hf = tmp_path / "hf"
    monkeypatch.setenv("HF_HUB_CACHE", str(hf))
    snap = hf / "models--Systran--faster-whisper-medium.en" / "snapshots" / "rev"
    _stub_tier(snap, "medium.en")

    from openreply.transcribe.models import discover_installed_external

    rows = {r["tier"]: r for r in discover_installed_external()}
    assert rows["medium.en"]["source"] == "custom"


def test_nothing_installed_returns_empty(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("HF_HUB_CACHE", str(tmp_path / "empty-hf"))
    monkeypatch.setenv("HOME", str(tmp_path / "fake-home"))
    monkeypatch.delenv("OPENREPLY_WHISPER_MODELS_DIR", raising=False)

    from openreply.transcribe.models import discover_installed_external
    assert discover_installed_external() == []


def test_download_skips_when_external_exists(tmp_path, monkeypatch):
    """download_model must short-circuit when the tier is already loadable
    from an external location — no HuggingFace call attempted."""
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path / "data"))
    custom = tmp_path / "custom"
    _stub_tier(custom / "tiny.en", "tiny.en")
    monkeypatch.setenv("OPENREPLY_WHISPER_MODELS_DIR", str(custom))

    from openreply.transcribe import models as m

    # If the short-circuit fails, we'd try to import huggingface_hub — blow
    # up loudly so the test fails fast instead of reaching the network.
    def _boom(*_a, **_kw):
        raise AssertionError("huggingface_hub must not be called when model exists")
    monkeypatch.setattr(m, "snapshot_download", _boom, raising=False)

    result = m.download_model("tiny.en")
    assert result["ok"] is True
    assert result["skipped"] is True
    assert result["reason"] == "already_installed"
    assert result["source"] == "custom"
    assert Path(result["path"]).resolve() == (custom / "tiny.en").resolve()


def test_resolve_model_path_prefers_app_dir(tmp_path, monkeypatch):
    """When both app-managed and external have a tier, app-managed wins."""
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path / "data"))
    # External
    custom = tmp_path / "custom"
    _stub_tier(custom / "base.en", "base.en")
    monkeypatch.setenv("OPENREPLY_WHISPER_MODELS_DIR", str(custom))
    # App-managed
    from openreply.transcribe.models import models_root, resolve_model_path
    _stub_tier(models_root() / "base.en", "base.en")

    p = resolve_model_path("base.en")
    assert p is not None
    assert p.resolve() == (models_root() / "base.en").resolve()


def test_catalogue_marks_external_installed(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("HF_HUB_CACHE", str(tmp_path / "hf"))
    monkeypatch.delenv("OPENREPLY_WHISPER_MODELS_DIR", raising=False)

    snap = tmp_path / "hf" / "models--Systran--faster-whisper-large-v3" / "snapshots" / "r"
    _stub_tier(snap, "large-v3")

    from openreply.transcribe.models import catalogue
    rows = {r["tier"]: r for r in catalogue()}
    assert rows["large-v3"]["installed"] is True
    assert rows["large-v3"]["source"] == "hf_hub"
    # An uninstalled tier stays uninstalled.
    assert rows["tiny.en"]["installed"] is False
    assert rows["tiny.en"]["source"] is None
