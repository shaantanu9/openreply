def test_paper_gaps_table_created(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core.db import get_db, init_schema
    db = get_db(); init_schema(db)
    assert "paper_gaps" in db.table_names()
    cols = {c.name for c in db["paper_gaps"].columns}
    assert {"id", "topic", "kind", "title", "detail_json",
            "evidence_post_ids_json", "score", "created_at"} <= cols
