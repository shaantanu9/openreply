"""Sweep orphaned PyInstaller onefile extraction dirs (``_MEIxxxxxx``).

A PyInstaller **onefile** build (which ``openreply-cli`` is) extracts the frozen
archive to a fresh ``$TMPDIR/_MEIxxxxxx`` directory on *every* launch and
removes it via an ``atexit`` handler on clean shutdown. Processes killed with
SIGKILL — or that hang mid-extraction because the disk is full — never run
that handler, so the directories leak.

On OpenReply this is not theoretical: leaked dirs accumulated to **93 dirs /
29 GB** and filled the data volume to 100%, at which point the bootloader
itself could no longer finish extracting and *every* launch hung in the
PyInstaller bootstrap (before any Python ran), breaking all CLI / MCP / data
calls. Sweeping orphaned dirs at startup keeps the leak from ever
accumulating, so a killed process can cost at most one extraction's worth of
disk until the next launch cleans it up.

Safety contract — a dir is removed only when ALL hold:
  1. it is NOT this process's own ``sys._MEIPASS``;
  2. no live process holds an open file inside it (psutil check); and
  3. it is older than ``grace_sec`` (so a *sibling* that is mid-extraction —
     its files not yet opened — is never touched).

If we cannot prove a dir is unused (psutil unavailable / scan error) we leave
it. Everything is best-effort and never raises into the caller.
"""

from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

__all__ = [
    "select_removable_meipass",
    "sweep_orphaned_meipass",
    "start_background_sweep",
]

# How old (seconds) an _MEI dir must be before we consider removing it. Guards
# against deleting a sibling launch that is still extracting (its files may not
# be open yet, so the psutil check alone wouldn't protect it).
DEFAULT_GRACE_SEC = 300

# Glob for PyInstaller onefile extraction dirs.
_MEI_GLOB = "_MEI*"


def select_removable_meipass(
    candidates: list[str],
    *,
    current: str | None,
    in_use: set[str],
    mtimes: dict[str, float],
    now: float,
    grace_sec: float = DEFAULT_GRACE_SEC,
) -> list[str]:
    """Pure decision function — pick which ``_MEI`` dirs are safe to delete.

    Separated from all I/O so the safety rules can be unit-tested without a
    real PyInstaller bundle or live processes.

    A candidate is removable iff it is not ``current``, not in ``in_use``, and
    its mtime is at least ``grace_sec`` in the past. Candidates with no known
    mtime are treated as too-fresh (kept) — we never delete what we can't date.
    """
    removable: list[str] = []
    cur = os.path.normpath(current) if current else None
    for raw in candidates:
        d = os.path.normpath(raw)
        if cur is not None and d == cur:
            continue
        if d in in_use or raw in in_use:
            continue
        mtime = mtimes.get(raw, mtimes.get(d))
        if mtime is None:
            continue  # unknown age → keep (conservative)
        if (now - mtime) < grace_sec:
            continue  # too fresh → might be a sibling mid-extraction
        removable.append(raw)
    return removable


def _meipass_parent() -> Path | None:
    """Directory that holds this process's ``_MEIxxxxxx`` dir, i.e. the temp
    root PyInstaller extracts into. ``None`` when not running frozen (dev/venv),
    in which case there is nothing to sweep."""
    meipass = getattr(sys, "_MEIPASS", None)
    if not meipass:
        return None
    try:
        return Path(os.path.normpath(meipass)).parent
    except Exception:
        return None


def _collect_in_use(candidates: list[str]) -> set[str]:
    """Set of candidate dirs that a live process currently has files open in.

    Restricted to ``openreply`` processes — they are the only ones that hold a
    openreply ``_MEI`` dir — which keeps the (potentially slow) ``open_files()``
    scan cheap. Returns an empty set if psutil is unavailable; the caller then
    sweeps nothing it cannot prove safe via the grace window alone, so callers
    that need the open-files guarantee should treat an empty set as "unknown"
    and rely on ``sweep_orphaned_meipass`` which bails when psutil is missing.
    """
    in_use: set[str] = set()
    try:
        import psutil  # type: ignore
    except Exception:
        return in_use
    norm = [os.path.normpath(c) for c in candidates]
    for p in psutil.process_iter(["pid", "name"]):
        try:
            name = (p.info.get("name") or "").lower()
            if "openreply" not in name:
                continue
            for f in p.open_files():
                fp = os.path.normpath(f.path)
                for c in norm:
                    if fp == c or fp.startswith(c + os.sep):
                        in_use.add(c)
        except Exception:
            continue
    return in_use


def sweep_orphaned_meipass(grace_sec: float = DEFAULT_GRACE_SEC) -> tuple[int, int]:
    """Remove orphaned ``_MEI`` dirs. Returns ``(dirs_removed, bytes_freed)``.

    No-op (returns ``(0, 0)``) when not running as a frozen onefile binary, or
    when psutil is unavailable (we refuse to delete what we can't prove unused).
    Never raises.
    """
    import shutil

    parent = _meipass_parent()
    if parent is None:
        return (0, 0)
    # Refuse to act without psutil — the open-files check is our only proof a
    # long-running sibling isn't actively using a dir. The grace window alone
    # can't protect a process that has been alive longer than grace_sec.
    try:
        import psutil  # type: ignore  # noqa: F401
    except Exception:
        return (0, 0)

    try:
        candidates = [str(d) for d in parent.glob(_MEI_GLOB) if d.is_dir()]
    except Exception:
        return (0, 0)
    if not candidates:
        return (0, 0)

    current = getattr(sys, "_MEIPASS", None)
    in_use = _collect_in_use(candidates)
    mtimes: dict[str, float] = {}
    for c in candidates:
        try:
            mtimes[c] = os.stat(c).st_mtime
        except OSError:
            pass
    now = time.time()
    removable = select_removable_meipass(
        candidates,
        current=current,
        in_use=in_use,
        mtimes=mtimes,
        now=now,
        grace_sec=grace_sec,
    )

    removed = 0
    freed = 0
    for d in removable:
        try:
            sz = _dir_size(d)
        except Exception:
            sz = 0
        try:
            shutil.rmtree(d, ignore_errors=True)
            if not os.path.exists(d):
                removed += 1
                freed += sz
        except Exception:
            continue
    return (removed, freed)


def _dir_size(path: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.lstat(os.path.join(root, f)).st_size
            except OSError:
                continue
    return total


def start_background_sweep(grace_sec: float = DEFAULT_GRACE_SEC) -> None:
    """Run :func:`sweep_orphaned_meipass` in a daemon thread.

    Fire-and-forget: cleanup is never on the critical path, so it must not add
    latency to CLI startup. Safe to call unconditionally — it self-noops in
    dev/venv (no ``sys._MEIPASS``). Swallows every error.
    """
    if getattr(sys, "_MEIPASS", None) is None:
        return  # not frozen — nothing to do, don't even spawn a thread

    def _run() -> None:
        try:
            sweep_orphaned_meipass(grace_sec)
        except Exception:
            pass

    try:
        t = threading.Thread(target=_run, name="meipass-sweep", daemon=True)
        t.start()
    except Exception:
        pass
