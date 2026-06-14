"""Task 4 — MCP tools for clarified-brief: gapmap_brief_get / gapmap_brief_set.

Mirrors tests/test_mcp_provenance_tools.py: seeds the DB via brief helpers,
reloads server.py so it inherits the patched GAPMAP_DATA_DIR, then calls the
tools directly via _TOOL_REGISTRY — no live FastMCP process needed.
"""
from __future__ import annotations

import importlib
import tempfile


def test_brief_mcp_get_set_roundtrip(monkeypatch, tmp_path):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))

    # Fresh DB.
    import gapmap.core.db as db_mod
    importlib.reload(db_mod)
    db_mod.get_db.cache_clear()
    db_mod.get_db()

    # Reload server to inherit patched env.
    import gapmap.mcp.server as server_mod
    importlib.reload(server_mod)

    registry = server_mod._TOOL_REGISTRY
    brief_set = registry["gapmap_brief_set"]
    brief_get = registry["gapmap_brief_get"]

    # Before any set — all fields should be empty strings.
    result = brief_get(topic="mytopic")
    assert result["ok"] is True
    assert result["topic"] == "mytopic"
    assert result["brief"]["goal"] == ""

    # Set a brief and read it back.
    set_result = brief_set(
        topic="mytopic",
        goal="find distribution gaps",
        constraints="2-week timeline",
        success="3 actionable gaps",
        audience="indie founders",
    )
    assert set_result["ok"] is True
    assert set_result["brief"]["goal"] == "find distribution gaps"

    get_result = brief_get(topic="mytopic")
    assert get_result["brief"]["goal"] == "find distribution gaps"
    assert get_result["brief"]["constraints"] == "2-week timeline"
    assert get_result["brief"]["success"] == "3 actionable gaps"
    assert get_result["brief"]["audience"] == "indie founders"


def test_brief_mcp_overwrite(monkeypatch, tmp_path):
    """Setting a brief twice replaces the first value (upsert semantics)."""
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))

    import gapmap.core.db as db_mod
    importlib.reload(db_mod)
    db_mod.get_db.cache_clear()
    db_mod.get_db()

    import gapmap.mcp.server as server_mod
    importlib.reload(server_mod)

    registry = server_mod._TOOL_REGISTRY
    brief_set = registry["gapmap_brief_set"]
    brief_get = registry["gapmap_brief_get"]

    brief_set(topic="t2", goal="first goal")
    brief_set(topic="t2", goal="second goal")

    result = brief_get(topic="t2")
    assert result["brief"]["goal"] == "second goal", (
        f"Expected upserted value 'second goal'; got: {result['brief']['goal']!r}"
    )
