"""Task 2G.2 — MCP tools gapmap_runs_list and gapmap_run_get.

Seeds checks_ledger + lineage rows, reloads server.py (picks up patched env),
then calls the tool callables via _TOOL_REGISTRY — the same dict the MCP
dispatcher would invoke.
"""
from __future__ import annotations

import importlib
import tempfile


def test_gapmap_runs_list_returns_run(monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", tempfile.mkdtemp())

    import gapmap.core.db as db_mod
    importlib.reload(db_mod)
    db_mod.get_db.cache_clear()
    db_mod.get_db()

    db_mod.record_check(topic="llm_tools", run_id="RUN1", gate="enrich", operation="enrich", passed=True)
    db_mod.record_check(topic="llm_tools", run_id="RUN1", gate="quality", operation="enrich", passed=False)

    import gapmap.mcp.server as server_mod
    importlib.reload(server_mod)

    fn = server_mod._TOOL_REGISTRY["gapmap_runs_list"]
    runs = fn(topic="llm_tools")

    assert any(r["run_id"] == "RUN1" for r in runs), f"RUN1 not in runs: {runs}"
    r = next(r for r in runs if r["run_id"] == "RUN1")
    assert r["n_checks"] == 2, f"Expected 2 checks; got {r['n_checks']}"
    assert r["n_passed"] == 1, f"Expected 1 passed; got {r['n_passed']}"


def test_gapmap_runs_list_empty_topic_returns_all(monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", tempfile.mkdtemp())

    import gapmap.core.db as db_mod
    importlib.reload(db_mod)
    db_mod.get_db.cache_clear()
    db_mod.get_db()

    db_mod.record_check(topic="topic_a", run_id="RA", gate="g", operation="enrich", passed=True)
    db_mod.record_check(topic="topic_b", run_id="RB", gate="g", operation="enrich", passed=True)

    import gapmap.mcp.server as server_mod
    importlib.reload(server_mod)

    fn = server_mod._TOOL_REGISTRY["gapmap_runs_list"]
    runs = fn(topic="")
    run_ids = {r["run_id"] for r in runs}
    assert "RA" in run_ids and "RB" in run_ids, f"Expected RA and RB in {run_ids}"


def test_gapmap_run_get_returns_checks_and_lineage(monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", tempfile.mkdtemp())

    import gapmap.core.db as db_mod
    importlib.reload(db_mod)
    db_mod.get_db.cache_clear()
    db_mod.get_db()

    db_mod.record_check(topic="t", run_id="RX", gate="g", operation="enrich", passed=True)
    db_mod.record_lineage(
        topic="t",
        artifact_id="art1",
        artifact_kind="painpoint",
        produced_by="RX",
        from_post_ids=["p1"],
    )

    import gapmap.mcp.server as server_mod
    importlib.reload(server_mod)

    fn = server_mod._TOOL_REGISTRY["gapmap_run_get"]
    result = fn(run_id="RX")

    assert result["run_id"] == "RX"
    assert len(result["checks"]) == 1, f"Expected 1 check; got {result['checks']}"
    assert len(result["lineage"]) == 1, f"Expected 1 lineage; got {result['lineage']}"
    assert result["lineage"][0]["artifact_id"] == "art1"


def test_gapmap_run_get_unknown_returns_empty(monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", tempfile.mkdtemp())

    import gapmap.core.db as db_mod
    importlib.reload(db_mod)
    db_mod.get_db.cache_clear()
    db_mod.get_db()

    import gapmap.mcp.server as server_mod
    importlib.reload(server_mod)

    fn = server_mod._TOOL_REGISTRY["gapmap_run_get"]
    result = fn(run_id="nonexistent_run")
    assert result == {"run_id": "nonexistent_run", "checks": [], "lineage": []}
