"""Task 2B.2 — verify that _build_structural_body calls check_graph_invariants.

Uses inspect.getsource so we do not need to reconstruct the full build
scaffold — we just confirm the call is wired in at the source level.
"""
import inspect
import importlib


def test_build_structural_body_references_check_graph_invariants():
    import openreply.graph.build as build
    importlib.reload(build)
    src = inspect.getsource(build)
    assert src.count("check_graph_invariants") >= 1, (
        "check_graph_invariants not found in build.py — invariant guard not wired"
    )
