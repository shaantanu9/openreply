"""Task 2C.1 — traceability_for_artifact: artifact → source posts via lineage.

Tests that the helper correctly joins lineage.from_post_ids (JSON array) with
the posts table to return the originating posts for a graph node/artifact.
"""
from __future__ import annotations

import importlib
import tempfile


def _db(monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", tempfile.mkdtemp())
    import openreply.core.db as db
    importlib.reload(db)
    db.get_db.cache_clear()
    db.get_db()
    return db


def test_traceability_returns_source_posts(monkeypatch):
    db = _db(monkeypatch)
    conn = db.get_db()
    conn["posts"].insert(
        {"id": "p1", "title": "slow sync complaint", "url": "https://x/p1", "source_type": "reddit"},
        pk="id", alter=True,
    )
    conn["posts"].insert(
        {"id": "p2", "title": "another", "url": "https://x/p2", "source_type": "hackernews"},
        pk="id", alter=True,
    )
    db.record_lineage(topic="t", artifact_id="node1", artifact_kind="painpoint", from_post_ids=["p1", "p2"])

    import openreply.research.traceability as tr
    importlib.reload(tr)
    rows = tr.traceability_for_artifact("node1")
    ids = {r["id"] for r in rows}
    assert ids == {"p1", "p2"}
    assert any(r["title"] == "slow sync complaint" for r in rows)


def test_traceability_unknown_returns_empty(monkeypatch):
    db = _db(monkeypatch)
    import openreply.research.traceability as tr
    importlib.reload(tr)
    assert tr.traceability_for_artifact("nope") == []


def test_traceability_never_raises(monkeypatch):
    db = _db(monkeypatch)
    import openreply.research.traceability as tr
    importlib.reload(tr)
    monkeypatch.setattr(tr, "get_db", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert tr.traceability_for_artifact("x") == []
