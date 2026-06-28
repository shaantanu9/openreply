import pytest
from openreply.retrieval import palace

@pytest.mark.skipif(not palace.is_available(), reason="chromadb not installed")
def test_neighbors_excludes_self_and_ranks(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    palace.drop_caches() if hasattr(palace, "drop_caches") else None
    def chunks(pid, text):
        return [{"id": f"{pid}#sec=abstract#ord=0", "post_id": pid,
                 "section": "abstract", "ord": 0, "text": text,
                 "char_count": len(text), "hash": pid}]
    palace.upsert_paper_chunks(chunks("p1", "graph neural networks for molecules"), post_id="p1", topic="t")
    palace.upsert_paper_chunks(chunks("p2", "graph neural network molecular property prediction"), post_id="p2", topic="t")
    palace.upsert_paper_chunks(chunks("p3", "ancient roman pottery kilns"), post_id="p3", topic="t")
    out = palace.paper_neighbors("p1", k=5)
    assert out["ok"] is True
    ids = [r["post_id"] for r in out["results"]]
    assert "p1" not in ids                 # self excluded
    assert ids and ids[0] == "p2"          # closest neighbor ranked first
