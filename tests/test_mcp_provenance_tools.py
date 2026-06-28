"""Task 8 — MCP read tools for checks_ledger and lineage.

Tests that openreply_checks_list and openreply_lineage_get return rows that
were seeded via the record_check / record_lineage helpers.

The tools are registered via _TOOL_REGISTRY in server.py (populated by the
_wrap_tool_for_logging decorator). We access them through that registry so
we're calling the same callables the MCP dispatcher would invoke, without
needing a live FastMCP server process.
"""
from __future__ import annotations

import importlib
import tempfile


def test_checks_and_lineage_tools(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))

    # Fresh DB handle.
    import openreply.core.db as db_mod
    importlib.reload(db_mod)
    db_mod.get_db.cache_clear()
    db = db_mod.get_db()

    # Seed one checks_ledger row and one lineage row.
    db_mod.record_check(topic="t", gate="g", operation="o", passed=True)
    db_mod.record_lineage(
        topic="t", artifact_id="a1", artifact_kind="painpoint",
        from_post_ids=["p1"],
    )

    # Reload server so it inherits the patched OPENREPLY_DATA_DIR.
    import openreply.mcp.server as server_mod
    importlib.reload(server_mod)

    # Retrieve the underlying callables from the tool registry (same dict
    # _wrap_tool_for_logging populates — the dispatcher key is the function name).
    registry = server_mod._TOOL_REGISTRY
    checks_fn = registry["openreply_checks_list"]
    lineage_fn = registry["openreply_lineage_get"]

    checks = checks_fn(topic="t")
    lin = lineage_fn(artifact_id="a1")

    assert any(r["gate"] == "g" for r in checks), (
        f"Expected gate='g' row in openreply_checks_list result; got: {checks}"
    )
    assert any(r["artifact_id"] == "a1" for r in lin), (
        f"Expected artifact_id='a1' row in openreply_lineage_get result; got: {lin}"
    )
