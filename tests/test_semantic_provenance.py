import tempfile, importlib


def test_semantic_tags_llm_and_lineage(monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", tempfile.mkdtemp())
    import gapmap.core.db as db; importlib.reload(db); db.get_db()
    import gapmap.graph.semantic as s; importlib.reload(s)
    s.upsert_semantic("t", painpoints=[{"painpoint": "slow sync"}])
    nodes = list(db.get_db().query("SELECT provenance FROM graph_nodes WHERE kind='painpoint'"))
    assert nodes and nodes[0]["provenance"] in ("llm", "llm_fallback")
    lin = list(db.get_db().query("SELECT * FROM lineage WHERE artifact_kind='painpoint'"))
    assert lin
