import tempfile, importlib, json


def _db(monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", tempfile.mkdtemp())
    import gapmap.core.db as db; importlib.reload(db); db.get_db()
    return db


def test_record_check_roundtrip(monkeypatch):
    db = _db(monkeypatch)
    rid = db.record_check(topic="t", gate="json_parse", operation="enrich",
                          passed=True, provider="ollama", model="x", detail="ok")
    assert rid and rid > 0
    rows = list(db.get_db().query("SELECT * FROM checks_ledger WHERE topic='t'"))
    assert rows[0]["gate"] == "json_parse" and rows[0]["passed"] == 1


def test_record_lineage_roundtrip(monkeypatch):
    db = _db(monkeypatch)
    rid = db.record_lineage(topic="t", artifact_id="n1", artifact_kind="painpoint",
                            produced_by="run123", from_post_ids=["p1", "p2"], decision="d")
    assert rid and rid > 0
    rows = list(db.get_db().query("SELECT * FROM lineage WHERE artifact_id='n1'"))
    assert json.loads(rows[0]["from_post_ids"]) == ["p1", "p2"]


def test_record_check_never_raises_on_bad_db(monkeypatch):
    db = _db(monkeypatch)
    monkeypatch.setattr(db, "get_db", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert db.record_check(topic="t", gate="g", operation="o", passed=False) == -1
