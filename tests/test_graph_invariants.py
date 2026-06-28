import tempfile, importlib


def _db(monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", tempfile.mkdtemp())
    import openreply.core.db as db; importlib.reload(db); db.get_db(); return db


def _seed(db, edges, nodes):
    c = db.get_db()
    for n in nodes:
        c["graph_nodes"].insert(n, pk="id", alter=True)
    for e in edges:
        c["graph_edges"].insert(e, alter=True)


def test_clean_graph_passes(monkeypatch):
    db = _db(monkeypatch)
    _seed(db, [{"src": "t::topic::x", "dst": "t::painpoint::a", "kind": "has", "topic": "t"}],
          [{"id": "t::topic::x", "topic": "t", "kind": "topic", "label": "x"},
           {"id": "t::painpoint::a", "topic": "t", "kind": "painpoint", "label": "a"}])
    import openreply.graph.invariants as inv; importlib.reload(inv)
    r = inv.check_graph_invariants("t")
    assert r["ok"] is True
    rows = list(db.get_db().query("SELECT * FROM checks_ledger WHERE topic='t' AND gate LIKE 'invariant_%'"))
    assert rows  # results recorded to the ledger


def test_cycle_fails(monkeypatch):
    db = _db(monkeypatch)
    _seed(db, [{"src": "a", "dst": "b", "kind": "x", "topic": "t"},
               {"src": "b", "dst": "a", "kind": "x", "topic": "t"}],
          [{"id": "a", "topic": "t", "kind": "topic", "label": "a"},
           {"id": "b", "topic": "t", "kind": "painpoint", "label": "b"}])
    import openreply.graph.invariants as inv; importlib.reload(inv)
    r = inv.check_graph_invariants("t")
    assert any(c["invariant"] == "acyclic" and not c["passed"] for c in r["checks"])


def test_missing_label_fails(monkeypatch):
    db = _db(monkeypatch)
    _seed(db, [], [{"id": "a", "topic": "t", "kind": "topic", "label": ""}])
    import openreply.graph.invariants as inv; importlib.reload(inv)
    r = inv.check_graph_invariants("t")
    assert any(c["invariant"] == "required_fields" and not c["passed"] for c in r["checks"])


def test_empty_graph_skips(monkeypatch):
    _db(monkeypatch)
    import openreply.graph.invariants as inv; importlib.reload(inv)
    r = inv.check_graph_invariants("nope")
    assert r.get("ok") is True  # never raises; empty graph is not a failure
