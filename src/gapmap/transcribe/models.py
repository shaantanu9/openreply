"""Whisper model catalogue + download / list / delete + external-discovery.

Models live under ``$GAPMAP_DATA_DIR/whisper-models/<tier>/`` by default,
but the app also auto-detects Whisper models the user already has on disk
from other Python projects (HuggingFace hub cache, ``GAPMAP_WHISPER_MODELS_DIR``,
common system locations) and re-uses them — no redundant download.

Resolution priority for a given tier:

    1. App-managed dir:  ``<data>/whisper-models/<tier>/``
    2. Env override:     ``$GAPMAP_WHISPER_MODELS_DIR/<tier>/``
    3. HF hub cache:     ``~/.cache/huggingface/hub/models--Systran--faster-whisper-<tier>/snapshots/<rev>/``
    4. Common dirs:      ``~/.cache/whisper/<tier>/``, ``~/whisper-models/<tier>/``, ``/opt/whisper/<tier>/``

Downloaded from public ``Systran/faster-whisper-*`` HuggingFace repos, no
token required.
"""
from __future__ import annotations

import os
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

# Tier → repo/size/realtime-factor. `rtf` ≈ seconds-of-CPU per second-of-audio
# on an M1 (CPU-only, int8 quantized). Used by the UI for ETA estimates.
MODELS: dict[str, dict] = {
    "tiny.en":   {"repo": "Systran/faster-whisper-tiny.en",   "size_mb": 75,   "rtf": 0.10},
    "base.en":   {"repo": "Systran/faster-whisper-base.en",   "size_mb": 145,  "rtf": 0.20},
    "small.en":  {"repo": "Systran/faster-whisper-small.en",  "size_mb": 480,  "rtf": 0.50},
    "medium.en": {"repo": "Systran/faster-whisper-medium.en", "size_mb": 1500, "rtf": 1.00},
    "large-v3":  {"repo": "Systran/faster-whisper-large-v3",  "size_mb": 2900, "rtf": 2.00},
}

DEFAULT_TIER = "small.en"

# Files `faster-whisper` requires to load a model. If both are present in a
# candidate directory, we consider the tier usable even when other files
# (tokenizer_config.json, etc.) are missing.
_REQUIRED_FILES = ("model.bin", "tokenizer.json")


def _data_root() -> Path:
    """Mirrors the logic in core/config.py so we don't import it (keeps this
    module dependency-free for tests)."""
    env = os.environ.get("GAPMAP_DATA_DIR")
    if env:
        return Path(env)
    return Path.home() / ".config" / "gapmap"


def models_root() -> Path:
    return _data_root() / "whisper-models"


# ── external discovery ───────────────────────────────────────────────────────

def _has_required_files(d: Path) -> bool:
    if not d.is_dir():
        return False
    return all((d / f).is_file() for f in _REQUIRED_FILES)


def _hf_cache_dir() -> Path:
    """HuggingFace hub's canonical cache dir, honouring HF_HOME / HF_HUB_CACHE."""
    hub = os.environ.get("HF_HUB_CACHE")
    if hub:
        return Path(hub)
    home = os.environ.get("HF_HOME")
    if home:
        return Path(home) / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def _hf_tier_snapshot(tier: str) -> Path | None:
    """Resolve the current snapshot dir for ``Systran/faster-whisper-<tier>``.

    HuggingFace stores models as
        <cache>/models--<org>--<name>/snapshots/<revision>/...

    The ``refs/main`` file points at the current revision. We prefer that;
    fall back to any snapshot dir whose contents include the required files.
    Returns None when nothing usable is present.
    """
    info = MODELS.get(tier)
    if not info:
        return None
    repo_id = info["repo"]  # e.g. Systran/faster-whisper-small.en
    slug = "models--" + repo_id.replace("/", "--")
    model_dir = _hf_cache_dir() / slug
    if not model_dir.is_dir():
        return None

    # Preferred: follow refs/main → that exact snapshot.
    refs = model_dir / "refs" / "main"
    if refs.is_file():
        try:
            rev = refs.read_text().strip()
            snap = model_dir / "snapshots" / rev
            if _has_required_files(snap):
                return snap
        except OSError:
            pass

    # Fallback: scan every snapshot dir, newest first.
    snaps_root = model_dir / "snapshots"
    if snaps_root.is_dir():
        cand = sorted(
            (p for p in snaps_root.iterdir() if p.is_dir()),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for snap in cand:
            if _has_required_files(snap):
                return snap
    return None


def _common_dir_candidates(tier: str) -> list[tuple[str, Path]]:
    """Return (source-label, candidate-path) pairs to probe for an existing
    model dir that contains the tier's required files directly under
    ``<candidate>/<tier>/``."""
    out: list[tuple[str, Path]] = []
    env_dir = os.environ.get("GAPMAP_WHISPER_MODELS_DIR")
    if env_dir:
        out.append(("custom", Path(env_dir) / tier))
    out.extend([
        ("system", Path.home() / ".cache" / "whisper" / tier),
        ("system", Path.home() / "whisper-models" / tier),
        ("system", Path("/opt") / "whisper" / tier),
    ])
    return out


def discover_installed_external() -> list[dict]:
    """Scan every external location the app knows about for already-installed
    Whisper tiers. Used to reuse (not re-download) models the user already
    has from other projects.

    Returns a list of ``{tier, path, size_mb, rtf, source, installed}``
    dicts, one per tier found. Dedupes by tier, picking the first match
    according to the priority order documented at the top of the module.
    """
    seen: dict[str, dict] = {}

    def _record(tier: str, source: str, path: Path) -> None:
        if tier in seen:
            return
        if not _has_required_files(path):
            return
        try:
            size = sum(p.stat().st_size for p in path.rglob("*") if p.is_file())
        except OSError:
            size = 0
        seen[tier] = {
            "tier": tier,
            "repo": MODELS[tier]["repo"],
            "size_mb": round(size / (1024 * 1024), 1),
            "rtf": MODELS[tier]["rtf"],
            "installed": True,
            "path": str(path),
            "source": source,
        }

    for tier in MODELS:
        # Env override first (power users / shared machines).
        env_dir = os.environ.get("GAPMAP_WHISPER_MODELS_DIR")
        if env_dir:
            _record(tier, "custom", Path(env_dir) / tier)
        # HuggingFace hub cache — the common case: any user of
        # `faster-whisper` / `huggingface_hub` already has snapshots here.
        hf = _hf_tier_snapshot(tier)
        if hf:
            _record(tier, "hf_hub", hf)
        # Common paths.
        for source, cand in _common_dir_candidates(tier):
            if cand != (Path(env_dir) / tier if env_dir else None):
                _record(tier, source, cand)

    return list(seen.values())


def resolve_model_path(tier: str) -> Path | None:
    """Return the absolute path to load for ``tier``, or None if absent.

    App-managed dir wins; otherwise the first external hit (see
    ``discover_installed_external``). Callers (WhisperModel loader, CLI
    checks) use the returned path directly — no files are copied or moved.
    """
    if tier not in MODELS:
        return None
    app_dir = models_root() / tier
    if _has_required_files(app_dir):
        return app_dir
    for ext in discover_installed_external():
        if ext["tier"] == tier:
            return Path(ext["path"])
    return None


# ── public API ───────────────────────────────────────────────────────────────

def list_installed() -> list[dict]:
    """Enumerate every tier the app can currently load — union of
    app-managed and externally-discovered (HF cache / env dir / system).
    Deduped on tier; app-managed wins on conflict (its dir keeps any custom
    tweaks the user made, and it's the only dir we'd delete from)."""
    out: list[dict] = []
    seen: set[str] = set()

    # 1. App-managed.
    root = models_root()
    if root.exists():
        for tier_dir in sorted(root.iterdir()):
            if not tier_dir.is_dir():
                continue
            tier = tier_dir.name
            if tier not in MODELS:
                continue
            if not _has_required_files(tier_dir):
                continue
            try:
                size = sum(p.stat().st_size for p in tier_dir.rglob("*") if p.is_file())
            except OSError:
                size = 0
            out.append({
                "tier": tier,
                "repo": MODELS[tier]["repo"],
                "size_mb": round(size / (1024 * 1024), 1),
                "rtf": MODELS[tier]["rtf"],
                "installed": True,
                "path": str(tier_dir),
                "source": "app",
            })
            seen.add(tier)

    # 2. External — only add tiers we didn't already find in the app dir.
    for ext in discover_installed_external():
        if ext["tier"] in seen:
            continue
        out.append(ext)
        seen.add(ext["tier"])

    # Stable, catalogue-order output.
    order = list(MODELS.keys())
    out.sort(key=lambda r: order.index(r["tier"]))
    return out


def catalogue() -> list[dict]:
    """Return every known tier with installed / source flags so the Settings
    UI and the onboarding Whisper step can render a single table."""
    installed_by_tier = {m["tier"]: m for m in list_installed()}
    out: list[dict] = []
    for tier, info in MODELS.items():
        hit = installed_by_tier.get(tier)
        out.append({
            "tier": tier,
            "repo": info["repo"],
            "size_mb": info["size_mb"],
            "rtf": info["rtf"],
            "installed": hit is not None,
            "source": hit.get("source") if hit else None,
            "path": hit.get("path") if hit else None,
        })
    return out


def default_tier() -> str:
    """Which tier is picked when the caller passes ``model='auto'``.

    Resolution order: ``.default`` marker file (if tier is loadable from
    anywhere — app dir OR external) → first installed tier → DEFAULT_TIER.
    """
    marker = models_root() / ".default"
    if marker.exists():
        try:
            t = marker.read_text().strip()
            if t in MODELS and resolve_model_path(t) is not None:
                return t
        except OSError:
            pass
    installed = list_installed()
    return installed[0]["tier"] if installed else DEFAULT_TIER


def set_default_tier(tier: str) -> None:
    if tier not in MODELS:
        raise ValueError(f"Unknown tier: {tier!r}. Valid: {sorted(MODELS)}")
    root = models_root()
    root.mkdir(parents=True, exist_ok=True)
    (root / ".default").write_text(tier)


def download_model(
    tier: str,
    progress_cb: Callable[[dict], None] | None = None,
) -> dict:
    """Download (or reuse) a model tier.

    Pre-check: if the tier is already loadable from an external location
    (HF hub cache, env dir, system dir), short-circuit with a skipped-
    download result. Otherwise snapshot-download from HuggingFace.

    Returns a summary dict::

        { "ok": True, "tier": <t>, "path": <str>, "source": "app"|"hf_hub"|...,
          "skipped": <bool>, "reason": <str when skipped> }

    Changed return type from ``Path`` → ``dict`` so the CLI/UI can reflect
    "reused an existing install" vs. "freshly downloaded".
    """
    if tier not in MODELS:
        raise ValueError(f"Unknown tier: {tier!r}. Valid: {sorted(MODELS)}")

    # Short-circuit: model already present somewhere we can load it from.
    existing = resolve_model_path(tier)
    if existing is not None:
        ext_source = "app"
        if not str(existing).startswith(str(models_root())):
            for row in discover_installed_external():
                if row["tier"] == tier:
                    ext_source = row["source"]
                    break
        if progress_cb:
            progress_cb({
                "tier": tier, "stage": "skip", "pct": 100, "done": True,
                "reason": "already_installed", "source": ext_source,
                "path": str(existing),
            })
        return {
            "ok": True, "tier": tier, "path": str(existing),
            "source": ext_source, "skipped": True,
            "reason": "already_installed",
        }

    try:
        from huggingface_hub import snapshot_download
    except ImportError as e:  # pragma: no cover
        raise RuntimeError(
            "Install the video extra: pip install -e '.[video]'"
        ) from e

    info = MODELS[tier]
    target = models_root() / tier
    target.mkdir(parents=True, exist_ok=True)
    if progress_cb:
        progress_cb({
            "tier": tier,
            "stage": "download",
            "pct": 0,
            "done": False,
            "downloaded_mb": 0.0,
            "total_mb": info["size_mb"],
        })

    expected_bytes = max(int(float(info["size_mb"]) * 1024 * 1024), 1)
    stop_poll = threading.Event()

    def _folder_size_bytes(d: Path) -> int:
        total = 0
        try:
            for p in d.rglob("*"):
                if p.is_file():
                    try:
                        total += p.stat().st_size
                    except OSError:
                        pass
        except OSError:
            pass
        return total

    def _emit_download_progress() -> None:
        # snapshot_download doesn't expose a stable per-file callback for every
        # install path/version we support, so we estimate from bytes on disk.
        # We cap at 99% until the call returns and we confirm completion.
        last_pct = -1.0
        while not stop_poll.wait(0.75):
            done_bytes = _folder_size_bytes(target)
            pct = round(min(99.0, (done_bytes / expected_bytes) * 100.0), 1)
            if pct <= last_pct:
                continue
            last_pct = pct
            if progress_cb:
                progress_cb({
                    "tier": tier,
                    "stage": "download",
                    "pct": pct,
                    "done": False,
                    "downloaded_mb": round(done_bytes / (1024 * 1024), 1),
                    "total_mb": info["size_mb"],
                })

    poller = threading.Thread(target=_emit_download_progress, daemon=True)
    poller.start()

    # allow_patterns keeps us to the actual model files — skips the repo's
    # README / images / LFS pointers for things we never load.
    try:
        snapshot_download(
            repo_id=info["repo"],
            local_dir=str(target),
            local_dir_use_symlinks=False,
            allow_patterns=["*.bin", "*.json", "*.txt", "*.model"],
        )
    finally:
        stop_poll.set()
        poller.join(timeout=1.0)

    (target / ".downloaded_at").write_text(
        f"{datetime.now(timezone.utc).isoformat(timespec='seconds')}\n"
        f"tier={tier}\nrepo={info['repo']}\n"
    )
    if progress_cb:
        final_bytes = _folder_size_bytes(target)
        progress_cb({
            "tier": tier,
            "stage": "download",
            "pct": 100,
            "done": True,
            "downloaded_mb": round(final_bytes / (1024 * 1024), 1),
            "total_mb": info["size_mb"],
        })
    return {
        "ok": True, "tier": tier, "path": str(target),
        "source": "app", "skipped": False,
    }


def delete_model(tier: str) -> bool:
    """Remove an installed tier from the APP-MANAGED dir only.

    External installs (HF cache, env dir, system dir) are not owned by the
    app and are left alone — Delete is only exposed in the UI for rows with
    ``source == 'app'``.
    """
    target = models_root() / tier
    if not target.exists():
        return False
    shutil.rmtree(target)
    return True
