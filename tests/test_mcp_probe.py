"""Tests for the MCP liveness probe (`probe_server_handshake`) and the
truthful `status(probe=True)` path.

These guard the "app says Connected, client says failed-to-connect" bug: a
config entry can be present and DB-aligned while the configured binary never
completes an MCP handshake. The probe is the only check that catches it.
"""

import json
import os
import sys
from pathlib import Path

import pytest

from openreply.mcp import install


def test_probe_spawn_failure_is_not_live():
    res = install.probe_server_handshake(
        "/nonexistent/definitely/not/a/binary", ["mcp", "serve"], {}, timeout=2.0
    )
    assert res["live"] is False
    assert res["handshake_ms"] is None
    assert "spawn failed" in (res["error"] or "")


def test_probe_no_response_times_out():
    # `cat` reads our request and echoes it back, but never emits a JSON-RPC
    # *result* — exactly like a server that hangs after start. Must report
    # not-live within the timeout rather than blocking forever.
    res = install.probe_server_handshake("/bin/cat", [], {}, timeout=2.0)
    assert res["live"] is False
    assert "within" in (res["error"] or "")


def test_status_probe_false_keeps_introspection_only(tmp_path):
    # With probe=False, status must not spawn anything and live stays None.
    cfg = tmp_path / ".claude.json"
    cfg.write_text(json.dumps({"mcpServers": {}}), encoding="utf-8")
    out = install.status(config_path=cfg, data_dir=tmp_path, probe=False)
    assert out["live"] is None
    assert out["handshake_ms"] is None


def test_status_probe_on_hanging_command_reports_not_connected(tmp_path):
    # Entry exists (installed) but command never handshakes → connected=False.
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    cfg = tmp_path / ".claude.json"
    cfg.write_text(
        json.dumps(
            {
                "mcpServers": {
                    "openreply": {
                        "command": "/bin/cat",
                        "args": [],
                        "env": {"OPENREPLY_DATA_DIR": str(data_dir)},
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    out = install.status(config_path=cfg, data_dir=data_dir, probe=True, probe_timeout=2.0)
    assert out["installed"] is True          # entry is present...
    assert out["live"] is False              # ...but it never answered
    assert out["connected"] is False         # so we DON'T claim connected
    assert "did not" in (out["reason"] or "").lower() or "hang" in (out["reason"] or "").lower()


@pytest.mark.slow
def test_probe_real_venv_binary_is_live():
    # Integration: the dev-venv console-script is a real, fast MCP server.
    venv_bin = Path(__file__).resolve().parents[1] / ".venv" / "bin" / "openreply"
    if not venv_bin.is_file():
        pytest.skip("dev venv openreply binary not present")
    res = install.probe_server_handshake(
        str(venv_bin), ["mcp", "serve"],
        {"OPENREPLY_IDLE_TIMEOUT": "0", "MCP_TAKEOVER_STALE_LOCK": "1"},
        timeout=40.0,
    )
    assert res["live"] is True, res
    assert isinstance(res["handshake_ms"], int)
