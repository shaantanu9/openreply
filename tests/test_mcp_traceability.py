"""Task 2C.2 — MCP tool openreply_traceability.

Seeds posts + lineage rows, reloads server.py (picks up patched env), then
calls the tool via _TOOL_REGISTRY — the same dict _wrap_tool_for_logging
populates and the MCP dispatcher would invoke.
"""
from __future__ import annotations

import importlib
import tempfile


def test_openreply_traceability_returns_source_posts(monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", tempfile.mkdtemp())

    # Fresh DB handle.
    import openreply.core.db as db_mod
    importlib.reload(db_mod)
    db_mod.get_db.cache_clear()
    db = db_mod.get_db()

    # Seed two posts and a lineage row linking both to artifact "node42".
    db["posts"].insert(
        {"id": "px1", "title": "auth is broken", "url": "https://r/px1", "source_type": "reddit"},
        pk="id", alter=True,
    )
    db["posts"].insert(
        {"id": "px2", "title": "login fails on mobile", "url": "https://r/px2", "source_type": "hackernews"},
        pk="id", alter=True,
    )
    db_mod.record_lineage(
        topic="auth_topic",
        artifact_id="node42",
        artifact_kind="painpoint",
        from_post_ids=["px1", "px2"],
    )

    # Reload server so it inherits the patched OPENREPLY_DATA_DIR.
    import openreply.mcp.server as server_mod
    importlib.reload(server_mod)

    trace_fn = server_mod._TOOL_REGISTRY["openreply_traceability"]
    rows = trace_fn(artifact_id="node42")

    ids = {r["id"] for r in rows}
    assert ids == {"px1", "px2"}, f"Expected post ids {{px1,px2}}; got {ids}"
    assert any(r["title"] == "auth is broken" for r in rows), (
        f"Expected 'auth is broken' title; got {[r.get('title') for r in rows]}"
    )
    assert any(r["source_type"] == "hackernews" for r in rows), (
        f"Expected hackernews source_type; got {[r.get('source_type') for r in rows]}"
    )


def test_openreply_traceability_unknown_returns_empty(monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", tempfile.mkdtemp())

    import openreply.core.db as db_mod
    importlib.reload(db_mod)
    db_mod.get_db.cache_clear()
    db_mod.get_db()

    import openreply.mcp.server as server_mod
    importlib.reload(server_mod)

    trace_fn = server_mod._TOOL_REGISTRY["openreply_traceability"]
    assert trace_fn(artifact_id="does_not_exist") == []
