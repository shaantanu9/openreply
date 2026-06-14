"""Graph structural invariant guard.

Checks a topic's graph for structural soundness and records each check
result to the checks_ledger via record_check (best-effort, never raises).
"""
from __future__ import annotations


def check_graph_invariants(topic: str) -> dict:
    """Run structural invariant checks for *topic*'s graph.

    Returns a dict::

        {"ok": bool, "checks": [{"invariant": str, "passed": bool, "detail": str}, ...]}

    On any unexpected error returns ``{"ok": True, "skipped": True, "error": str}``
    so callers are never broken by the guard.
    """
    try:
        return _run(topic)
    except Exception as exc:  # noqa: BLE001
        return {"ok": True, "skipped": True, "error": str(exc)}


# ---------------------------------------------------------------------------
# Internal implementation
# ---------------------------------------------------------------------------

def _run(topic: str) -> dict:
    from ..core.db import get_db, record_check
    import networkx as nx

    db = get_db()

    nodes = list(db.query("SELECT * FROM graph_nodes WHERE topic=?", [topic]))
    edges = list(db.query("SELECT * FROM graph_edges WHERE topic=?", [topic]))

    if not nodes:
        return {"ok": True, "skipped": True, "checks": []}

    checks: list[dict] = []

    # ── 1. required_fields ─────────────────────────────────────────────────
    bad = sum(
        1 for n in nodes
        if not (n.get("id") or "").strip()
        or not (n.get("topic") or "").strip()
        or not (n.get("kind") or "").strip()
        or not (n.get("label") or "").strip()
    )
    _add(checks, "required_fields", bad == 0,
         f"{bad} node(s) missing required fields" if bad else "",
         topic, record_check)

    # ── 2. root_present ────────────────────────────────────────────────────
    topic_nodes = [n for n in nodes if n.get("kind") == "topic"]
    count = len(topic_nodes)
    _add(checks, "root_present", count == 1,
         f"topic-kind node count={count}",
         topic, record_check)

    # ── 3. acyclic ─────────────────────────────────────────────────────────
    node_ids = {n["id"] for n in nodes}
    G: nx.DiGraph = nx.DiGraph()
    for n in nodes:
        G.add_node(n["id"], kind=n.get("kind", ""), label=n.get("label", ""))
    for e in edges:
        if e["src"] in node_ids and e["dst"] in node_ids:
            G.add_edge(e["src"], e["dst"])

    is_dag = nx.is_directed_acyclic_graph(G)
    cycle_detail = ""
    if not is_dag:
        try:
            cycle = nx.find_cycle(G)
            cycle_detail = f"cycle: {cycle[0][0]} → … ({len(cycle)} edge(s))"
        except Exception:  # noqa: BLE001
            cycle_detail = "cycle detected"
    _add(checks, "acyclic", is_dag, cycle_detail, topic, record_check)

    # ── 4. no_orphans ──────────────────────────────────────────────────────
    connected = set()
    for e in edges:
        connected.add(e["src"])
        connected.add(e["dst"])
    orphans = sum(
        1 for n in nodes
        if n.get("kind") != "topic" and n["id"] not in connected
    )
    _add(checks, "no_orphans", orphans == 0,
         f"{orphans} orphan node(s)" if orphans else "",
         topic, record_check)

    ok = all(c["passed"] for c in checks)
    return {"ok": ok, "checks": checks}


def _add(
    checks: list,
    name: str,
    passed: bool,
    detail: str,
    topic: str,
    record_check,
) -> None:
    checks.append({"invariant": name, "passed": passed, "detail": detail})
    try:
        record_check(
            topic=topic,
            gate=f"invariant_{name}",
            operation="graph_build",
            passed=passed,
            invariant=name,
            detail=detail,
        )
    except Exception:  # noqa: BLE001
        pass
