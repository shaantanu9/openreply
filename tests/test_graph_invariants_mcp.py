"""Task 2B.3 — MCP tool openreply_graph_invariants.

Seeds a minimal graph (one topic node + one painpoint + one edge), reloads
server.py so it picks up the patched OPENREPLY_DATA_DIR, then calls the tool
via _TOOL_REGISTRY — same dispatch path the MCP server uses at runtime.
Mirrors tests/test_mcp_traceability.py.
"""
from __future__ import annotations

import importlib
import tempfile


def test_openreply_graph_invariants_returns_checks(monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", tempfile.mkdtemp())

    import openreply.core.db as db_mod
    importlib.reload(db_mod)
    db_mod.get_db.cache_clear()
    db = db_mod.get_db()

    # Seed a clean graph — one topic root + one painpoint + one edge.
    db["graph_nodes"].insert(
        {"id": "t::topic::x", "topic": "t", "kind": "topic", "label": "x"},
        pk="id", alter=True,
    )
    db["graph_nodes"].insert(
        {"id": "t::painpoint::a", "topic": "t", "kind": "painpoint", "label": "a"},
        pk="id", alter=True,
    )
    db["graph_edges"].insert(
        {"src": "t::topic::x", "dst": "t::painpoint::a", "kind": "has", "topic": "t"},
        alter=True,
    )

    import openreply.mcp.server as server_mod
    importlib.reload(server_mod)

    inv_fn = server_mod._TOOL_REGISTRY["openreply_graph_invariants"]
    result = inv_fn(topic="t")

    assert "checks" in result, f"Expected 'checks' key; got {result}"
    assert isinstance(result["checks"], list), f"checks should be a list; got {type(result['checks'])}"
    assert len(result["checks"]) > 0, "Expected at least one invariant check"
    assert result.get("ok") is True, f"Expected ok=True for clean graph; got {result}"


def test_openreply_graph_invariants_empty_topic_is_ok(monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", tempfile.mkdtemp())

    import openreply.core.db as db_mod
    importlib.reload(db_mod)
    db_mod.get_db.cache_clear()
    db_mod.get_db()

    import openreply.mcp.server as server_mod
    importlib.reload(server_mod)

    inv_fn = server_mod._TOOL_REGISTRY["openreply_graph_invariants"]
    result = inv_fn(topic="no_such_topic")

    assert result.get("ok") is True, f"Empty topic should not fail; got {result}"
