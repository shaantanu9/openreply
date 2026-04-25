"""yt-dlp overlay + auto-updater.

The shipped PyInstaller bundle is codesigned → read-only. YouTube's cipher
rotations break yt-dlp's extractor roughly monthly, so bundling a pinned
version and hoping for the best doesn't scale.

Solution: on every sidecar cold-start, we prepend a user-writable overlay
dir to ``sys.path``. A background thread checks PyPI for a newer yt-dlp and
pip-installs it *into that overlay* if found. The next ``import yt_dlp``
picks up the overlay first. 24h cooldown via a stamp file so we don't
hammer PyPI on every invocation.

Everything is best-effort: if PyPI is down, the install fails, or the new
version is incompatible, the bundled wheel keeps working. No user-visible
error, just a log entry.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

COOLDOWN_S = 24 * 3600


def _data_root() -> Path:
    env = os.environ.get("REDDIT_MYIND_DATA_DIR")
    if env:
        return Path(env)
    return Path.home() / ".config" / "reddit-myind"


def overlay_dir() -> Path:
    return _data_root() / "ytdlp-overlay"


def _is_newer(latest: str, installed: str) -> bool:
    """Compare yt-dlp calendar-versioned strings (``2026.4.20``).

    Falls back to :mod:`packaging.version` when available (handles non-trivial
    suffixes); otherwise does a lexicographic tuple compare on dotted ints.
    """
    try:
        from packaging.version import Version
        return Version(latest) > Version(installed)
    except Exception:
        def parts(s: str) -> tuple:
            return tuple(int(x) for x in s.split(".") if x.isdigit())
        return parts(latest) > parts(installed)


def ytdlp_current_version() -> str:
    try:
        import yt_dlp
        return getattr(yt_dlp.version, "__version__", "0")
    except Exception:
        return "0"


def _pypi_latest_stable(pkg: str = "yt-dlp") -> str | None:
    try:
        with urllib.request.urlopen(
            f"https://pypi.org/pypi/{pkg}/json", timeout=5
        ) as r:
            data = json.load(r)
            return data.get("info", {}).get("version")
    except Exception:
        return None


def _inject_overlay_to_path() -> None:
    """Ensure the overlay is first on sys.path so its yt_dlp beats the bundled one."""
    od = str(overlay_dir())
    if od not in sys.path:
        sys.path.insert(0, od)


def ensure_latest_ytdlp(force: bool = False) -> dict:
    """Check PyPI + pip-install a newer yt-dlp into the overlay if available.

    Always returns a status dict — callers never need try/except. This runs
    synchronously; use :func:`ensure_latest_ytdlp_background` from the sidecar
    cold-start so the first ingest isn't blocked on a network round-trip.
    """
    od = overlay_dir()
    od.mkdir(parents=True, exist_ok=True)
    _inject_overlay_to_path()

    stamp = od / ".last-check"
    if not force and stamp.exists():
        try:
            age = time.time() - stamp.stat().st_mtime
            if age < COOLDOWN_S:
                return {"ok": True, "skipped": True, "reason": "cooldown",
                        "installed": ytdlp_current_version()}
        except OSError:
            pass

    installed = ytdlp_current_version()
    latest = _pypi_latest_stable("yt-dlp")
    if not latest:
        return {"ok": False, "reason": "pypi_unreachable",
                "installed": installed}

    if not _is_newer(latest, installed):
        try:
            stamp.touch()
        except OSError:
            pass
        return {"ok": True, "updated": False,
                "installed": installed, "latest": latest}

    # Install into the overlay WITHOUT deps so we don't accidentally upgrade
    # anything else the sidecar relies on (requests, certifi, etc.).
    try:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install",
             "--upgrade", "--target", str(od),
             "--no-deps", "--disable-pip-version-check",
             "yt-dlp"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError as e:
        return {"ok": False,
                "reason": f"pip_install_failed: {e.returncode}",
                "installed": installed, "latest": latest}
    except Exception as e:
        return {"ok": False, "reason": f"pip_install_exception: {e}",
                "installed": installed, "latest": latest}

    try:
        stamp.touch()
    except OSError:
        pass

    # If the new import crashes, roll the overlay off sys.path so the
    # bundled fallback keeps working on this session.
    try:
        # Clear cached modules so the next import re-reads from overlay.
        for mod in list(sys.modules):
            if mod == "yt_dlp" or mod.startswith("yt_dlp."):
                del sys.modules[mod]
        import yt_dlp  # noqa: F401
        new_version = ytdlp_current_version()
    except Exception as e:
        try:
            sys.path.remove(str(od))
        except ValueError:
            pass
        return {"ok": False, "reason": f"overlay_import_failed: {e}",
                "rolled_back": True, "installed": installed, "latest": latest}

    return {"ok": True, "updated": True,
            "from": installed, "to": new_version}


def ensure_latest_ytdlp_background() -> None:
    """Fire-and-forget update check. Safe to call on every sidecar boot."""
    # Inject overlay path synchronously so the same process sees it before
    # the first `import yt_dlp` (the bg thread only matters for *future* runs).
    _inject_overlay_to_path()
    t = threading.Thread(target=ensure_latest_ytdlp, daemon=True)
    t.start()
