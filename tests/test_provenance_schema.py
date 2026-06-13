import tempfile, importlib


def _fresh_db(monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", tempfile.mkdtemp())
    import gapmap.core.db as db; importlib.reload(db); db.get_db()
    return db


def test_schema_has_provenance_and_tables(monkeypatch):
    db = _fresh_db(monkeypatch)
    conn = db.get_db()
    cols = {c.name for c in conn["graph_nodes"].columns}
    assert "provenance" in cols
    assert "checks_ledger" in conn.table_names()
    assert "lineage" in conn.table_names()


def test_init_schema_idempotent(monkeypatch):
    db = _fresh_db(monkeypatch)
    db.init_schema(db.get_db()); db.init_schema(db.get_db())
    assert "lineage" in db.get_db().table_names()
