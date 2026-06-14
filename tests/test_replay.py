import tempfile, importlib
def _db(monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", tempfile.mkdtemp())
    import gapmap.core.db as db; importlib.reload(db); db.get_db(); return db
def test_list_runs_groups_and_excludes_empty(monkeypatch):
    db=_db(monkeypatch)
    db.record_check(topic="t", run_id="R1", gate="g1", operation="enrich", passed=True)
    db.record_check(topic="t", run_id="R1", gate="g2", operation="enrich", passed=False)
    db.record_check(topic="t", run_id="",   gate="g3", operation="enrich", passed=True)  # excluded
    import gapmap.research.replay as rp; importlib.reload(rp)
    runs = rp.list_runs()
    r1 = [r for r in runs if r["run_id"]=="R1"]
    assert r1 and r1[0]["n_checks"]==2 and r1[0]["n_passed"]==1
    assert all(r["run_id"] for r in runs)  # no empty run_id rows
def test_get_run_returns_checks_and_lineage(monkeypatch):
    db=_db(monkeypatch)
    db.record_check(topic="t", run_id="R9", gate="g", operation="enrich", passed=True)
    db.record_lineage(topic="t", artifact_id="n1", artifact_kind="painpoint", produced_by="R9", from_post_ids=["p1"])
    import gapmap.research.replay as rp; importlib.reload(rp)
    got = rp.get_run("R9")
    assert len(got["checks"])==1 and len(got["lineage"])==1
def test_never_raises(monkeypatch):
    _db(monkeypatch)
    import gapmap.research.replay as rp; importlib.reload(rp)
    monkeypatch.setattr(rp, "get_db", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert rp.list_runs()==[] and rp.get_run("x")=={"run_id":"x","checks":[],"lineage":[]}
