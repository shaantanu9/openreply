import tempfile, importlib


def test_upsert_node_writes_provenance(monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", tempfile.mkdtemp())
    import openreply.core.db as db; importlib.reload(db); db.get_db()
    import openreply.graph.build as b; importlib.reload(b)
    nid = b._upsert_node(db.get_db(), "topic", "painpoint", "k1", "label", provenance="llm")
    row = list(db.get_db().query("SELECT provenance FROM graph_nodes WHERE id=?", [nid]))
    assert row[0]["provenance"] == "llm"
