"""Task 1 — clarified-brief schema columns on topic_prefs."""
from __future__ import annotations

import importlib
import tempfile


def test_brief_columns_present(monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", tempfile.mkdtemp())
    import openreply.core.db as db
    importlib.reload(db)
    db.get_db()
    cols = {c.name for c in db.get_db()["topic_prefs"].columns}
    assert {"brief_goal", "brief_constraints", "brief_success", "brief_audience"} <= cols


def test_idempotent(monkeypatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", tempfile.mkdtemp())
    import openreply.core.db as db
    importlib.reload(db)
    db.init_schema(db.get_db())
    db.init_schema(db.get_db())
