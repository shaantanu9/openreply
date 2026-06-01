"""Tests for the orphaned-_MEI sweep safety rules.

The decision logic (`select_removable_meipass`) is pure and exhaustively
tested here without needing a real PyInstaller bundle or live processes. A
small integration test exercises `sweep_orphaned_meipass`'s no-op contract
outside a frozen build.
"""

import os
import sys
import time

from gapmap.core.meipass_cleanup import (
    select_removable_meipass,
    sweep_orphaned_meipass,
    start_background_sweep,
)

OLD = 10_000.0          # mtime far in the past → past the grace window
NOW = 10_000.0 + 1_000_000.0
GRACE = 300.0


def _mt(*dirs):
    return {d: OLD for d in dirs}


def test_removes_orphaned_old_dirs():
    dirs = ["/tmp/_MEIaaa", "/tmp/_MEIbbb"]
    out = select_removable_meipass(
        dirs, current="/tmp/_MEIcur", in_use=set(), mtimes=_mt(*dirs),
        now=NOW, grace_sec=GRACE,
    )
    assert set(out) == set(dirs)


def test_never_removes_current_process_dir():
    dirs = ["/tmp/_MEIcur", "/tmp/_MEIbbb"]
    out = select_removable_meipass(
        dirs, current="/tmp/_MEIcur", in_use=set(), mtimes=_mt(*dirs),
        now=NOW, grace_sec=GRACE,
    )
    assert out == ["/tmp/_MEIbbb"]


def test_current_dir_matched_after_normpath():
    # current passed with a trailing slash / redundant sep must still match.
    dirs = ["/tmp/_MEIcur", "/tmp/_MEIbbb"]
    out = select_removable_meipass(
        dirs, current="/tmp//_MEIcur/", in_use=set(), mtimes=_mt(*dirs),
        now=NOW, grace_sec=GRACE,
    )
    assert out == ["/tmp/_MEIbbb"]


def test_never_removes_in_use_dirs():
    dirs = ["/tmp/_MEIaaa", "/tmp/_MEIbbb"]
    out = select_removable_meipass(
        dirs, current=None, in_use={"/tmp/_MEIaaa"}, mtimes=_mt(*dirs),
        now=NOW, grace_sec=GRACE,
    )
    assert out == ["/tmp/_MEIbbb"]


def test_never_removes_too_fresh_dirs():
    # A sibling that started extracting `now - 10s` ago is inside the grace
    # window and must be kept even though no files are open in it yet.
    dirs = ["/tmp/_MEIfresh", "/tmp/_MEIold"]
    mtimes = {"/tmp/_MEIfresh": NOW - 10.0, "/tmp/_MEIold": OLD}
    out = select_removable_meipass(
        dirs, current=None, in_use=set(), mtimes=mtimes,
        now=NOW, grace_sec=GRACE,
    )
    assert out == ["/tmp/_MEIold"]


def test_keeps_dirs_with_unknown_mtime():
    dirs = ["/tmp/_MEInomtime", "/tmp/_MEIold"]
    mtimes = {"/tmp/_MEIold": OLD}  # nomtime absent → cannot date → keep
    out = select_removable_meipass(
        dirs, current=None, in_use=set(), mtimes=mtimes,
        now=NOW, grace_sec=GRACE,
    )
    assert out == ["/tmp/_MEIold"]


def test_all_guards_compose():
    dirs = [
        "/tmp/_MEIcur",     # current → keep
        "/tmp/_MEIbusy",    # in use → keep
        "/tmp/_MEIfresh",   # too fresh → keep
        "/tmp/_MEIgone",    # orphaned + old → REMOVE
    ]
    mtimes = {
        "/tmp/_MEIcur": OLD,
        "/tmp/_MEIbusy": OLD,
        "/tmp/_MEIfresh": NOW - 5.0,
        "/tmp/_MEIgone": OLD,
    }
    out = select_removable_meipass(
        dirs, current="/tmp/_MEIcur", in_use={"/tmp/_MEIbusy"},
        mtimes=mtimes, now=NOW, grace_sec=GRACE,
    )
    assert out == ["/tmp/_MEIgone"]


def test_sweep_is_noop_outside_frozen_build():
    # In dev/venv there is no sys._MEIPASS → must not touch the filesystem.
    assert not hasattr(sys, "_MEIPASS")
    assert sweep_orphaned_meipass() == (0, 0)


def test_background_sweep_noop_outside_frozen_build():
    # Must return immediately and spawn no thread when not frozen.
    before = _gapmap_sweep_threads()
    start_background_sweep()
    time.sleep(0.05)
    assert _gapmap_sweep_threads() == before


def _gapmap_sweep_threads():
    import threading
    return [t for t in threading.enumerate() if t.name == "meipass-sweep"]
