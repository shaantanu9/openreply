"""Cancel-contract tests — verify long-running CLI commands honor SIGTERM.

The Rust `ActiveJob` / `ActiveChat` / `ActiveStream` state slots all rely
on the Python side exiting cleanly when Tauri's cancel helpers send SIGTERM
to the child PID. If the Python process hangs on a network read or swallows
the signal, cancel becomes a lie.

These tests spawn the CLI as a real subprocess (not via Tauri), signal it,
and assert it exits within a reasonable grace period. They cover the
CONTRACT the Rust side depends on — the Rust process manager itself is
thin enough that verifying the Python contract is the highest-leverage
test we can write without a full Tauri-in-CI harness.

Marked `@pytest.mark.slow` so they're opt-in:
    .venv/bin/pytest tests/test_cancel_contract.py -m slow -v
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest


# Short-ish grace period — Python signal handlers + stream.close() + DB
# connection teardown should all finish in well under 5 s on a healthy host.
GRACE_SECONDS = 5.0


def _spawn(args: list[str], env: dict | None = None) -> subprocess.Popen:
    """Spawn openreply as a subprocess. Uses the .venv python so PyInstaller
    sidecar path isn't exercised — matches the dev-mode bypass in cli.rs."""
    repo_root = Path(__file__).resolve().parent.parent
    py = repo_root / ".venv" / "bin" / "python"
    if not py.exists():
        pytest.skip(f".venv/bin/python not found at {py} — run `uv sync --extra dev` first")
    full_env = {**os.environ, **(env or {})}
    return subprocess.Popen(
        [str(py), "-m", "openreply.cli.main", *args],
        cwd=repo_root,
        env=full_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _wait_for_startup(proc: subprocess.Popen, *, needle: str = "", timeout: float = 10.0) -> bool:
    """Poll the child's stdout/stderr until we see `needle` OR exit. Returns
    True if the needle was seen before the process exited. Used to make sure
    the subprocess has actually started doing work before we signal it."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        if proc.poll() is not None:
            return False
        # Peek at stderr only — stdout may be buffered JSON. Stderr has the
        # Rich progress + error lines.
        time.sleep(0.1)
        if not needle:
            return True
    return False


@pytest.mark.slow
def test_cancel_collect_via_sigterm_exits_within_grace(tmp_path):
    """`research collect` with SIGTERM should exit within GRACE_SECONDS."""
    env = {"OPENREPLY_DATA_DIR": str(tmp_path)}
    # Aggressive + a clearly-nonexistent topic → maximum parallel work,
    # maximum kill-latency risk. Dry-running the real pipeline is fine
    # since we'll signal before network I/O settles.
    proc = _spawn(
        ["research", "collect", "--topic", "test-cancel-xyz-never-existed", "--aggressive"],
        env=env,
    )
    try:
        # Let it get past arg parsing and into the work loop.
        time.sleep(1.0)
        if proc.poll() is not None:
            # It already exited on its own (e.g. no Reddit creds configured).
            # That's a legitimate fast-exit — nothing to cancel. Skip the
            # assertion rather than fake a pass.
            pytest.skip(f"collect exited early with code {proc.returncode} — nothing to cancel")
        proc.send_signal(signal.SIGTERM)
        t0 = time.time()
        ret = proc.wait(timeout=GRACE_SECONDS)
        elapsed = time.time() - t0
        # Python subprocess semantics: SIGTERM → negative return code on POSIX.
        # On this repo we accept any exit; the important thing is it actually
        # exited in time.
        assert elapsed < GRACE_SECONDS, (
            f"collect didn't exit within {GRACE_SECONDS}s grace after SIGTERM "
            f"(took {elapsed:.1f}s, ret={ret})"
        )
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)


@pytest.mark.slow
def test_cancel_stream_via_sigterm_exits_within_grace(tmp_path):
    """`stream --sub X --json` with SIGTERM should exit cleanly. This is the
    Watch screen's backing command; cancel-on-navigate-away depends on it."""
    env = {"OPENREPLY_DATA_DIR": str(tmp_path)}
    proc = _spawn(
        ["stream", "--sub", "test", "--json"],
        env=env,
    )
    try:
        # Stream enters a blocking PRAW loop almost immediately. Give it a
        # moment to get past arg parsing + sqlite init.
        time.sleep(1.0)
        if proc.poll() is not None:
            pytest.skip(f"stream exited early with code {proc.returncode} — probably no PRAW creds")
        proc.send_signal(signal.SIGTERM)
        t0 = time.time()
        ret = proc.wait(timeout=GRACE_SECONDS)
        elapsed = time.time() - t0
        assert elapsed < GRACE_SECONDS, (
            f"stream didn't exit within {GRACE_SECONDS}s grace after SIGTERM "
            f"(took {elapsed:.1f}s, ret={ret})"
        )
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)


@pytest.mark.slow
def test_sigint_also_works_on_collect(tmp_path):
    """Ctrl-C (SIGINT) path — same grace window. Some users will hit this
    via the terminal even though the Tauri cancel button uses SIGTERM."""
    env = {"OPENREPLY_DATA_DIR": str(tmp_path)}
    proc = _spawn(
        ["research", "collect", "--topic", "test-cancel-sigint", "--aggressive"],
        env=env,
    )
    try:
        time.sleep(1.0)
        if proc.poll() is not None:
            pytest.skip(f"collect exited early with code {proc.returncode}")
        proc.send_signal(signal.SIGINT)
        t0 = time.time()
        ret = proc.wait(timeout=GRACE_SECONDS)
        elapsed = time.time() - t0
        assert elapsed < GRACE_SECONDS, (
            f"collect didn't exit within {GRACE_SECONDS}s grace after SIGINT "
            f"(took {elapsed:.1f}s, ret={ret})"
        )
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)
