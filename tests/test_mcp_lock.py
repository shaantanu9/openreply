"""Regression tests for the MCP pidfile lock liveness check.

Root cause of `another_mcp_server_running` lockouts: a crashed MCP server
that the client (Claude Code / Cursor) has not yet reaped becomes a
**zombie**. `os.kill(pid, 0)` succeeds for a zombie, so the old liveness
check reported it alive — and SIGTERM/SIGKILL cannot touch a zombie, so
takeover gave up and the lock was permanently un-reclaimable.

`_is_alive` must report a zombie as dead.
"""
import os
import time

import pytest

from gapmap.mcp.server import _is_alive


def test_is_alive_true_for_self():
    assert _is_alive(os.getpid()) is True


@pytest.mark.skipif(not hasattr(os, "fork"), reason="needs POSIX fork")
def test_is_alive_false_for_reaped_pid():
    """A forked child that has been waited on is fully gone."""
    pid = os.fork()
    if pid == 0:  # child
        os._exit(0)
    os.waitpid(pid, 0)  # reap → pid no longer exists
    assert _is_alive(pid) is False


@pytest.mark.skipif(not hasattr(os, "fork"), reason="needs POSIX fork")
def test_is_alive_false_for_zombie():
    """A child that exited but has NOT been reaped is a zombie. os.kill(0)
    succeeds for it — _is_alive must still report it dead so the pidfile
    lock can be reclaimed."""
    pid = os.fork()
    if pid == 0:  # child
        os._exit(0)
    # parent: deliberately do NOT waitpid → child is now a zombie
    try:
        deadline = time.time() + 2.0
        while time.time() < deadline and _is_alive(pid):
            time.sleep(0.05)
        assert _is_alive(pid) is False, "zombie process must read as dead"
    finally:
        try:
            os.waitpid(pid, 0)  # reap
        except ChildProcessError:
            pass
