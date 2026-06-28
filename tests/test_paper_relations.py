def test_cites_edges_from_resolved_refs(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core.db import get_db, init_schema
    db = get_db(); init_schema(db)
    for pid in ("a", "b"):
        db["posts"].insert({"id": pid, "title": pid, "source_type": "arxiv"}, pk="id")
    db["topic_posts"].insert_all([
        {"topic": "t", "post_id": "a"}, {"topic": "t", "post_id": "b"}], pk=("topic", "post_id"))
    # a resolved reference: a cites b
    from openreply.research.paper_references import _ensure_table
    _ensure_table()
    db["paper_references"].insert({
        "src_post_id": "a", "dst_post_id": "b", "dst_doi": "",
        "dst_arxiv_id": "", "dst_title": "b", "dst_year": 2024, "dst_authors_json": "[]",
        "raw": "b et al", "resolution_status": "ok", "extractor": "test",
        "fetched_at": ""})
    from openreply.research.paper_relations import build
    out = build(topic="t", kinds=["cites"])
    assert out["ok"] is True
    edges = list(db.query(
        "SELECT src, dst, kind FROM graph_edges WHERE kind='paper_cites'"))
    assert {"src": "a", "dst": "b", "kind": "paper_cites"} in [dict(e) for e in edges]
    # Must NOT collide with the dense-graph-relations `cites` kind.
    assert list(db.query("SELECT 1 FROM graph_edges WHERE kind='cites'")) == []
