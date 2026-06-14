"""Task 2 — clarified-brief helpers: set/get/preamble/suggest."""
from __future__ import annotations

import importlib
import tempfile


def _db(monkeypatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", tempfile.mkdtemp())
    import gapmap.core.db as db
    importlib.reload(db)
    db.get_db()
    return db


def test_set_get_roundtrip(monkeypatch):
    _db(monkeypatch)
    import gapmap.research.brief as br
    importlib.reload(br)
    br.set_brief("t", goal="find gaps in note apps", constraints="indie budget", success="3 validated gaps", audience="solo devs")
    b = br.get_brief("t")
    assert b["goal"] == "find gaps in note apps" and b["success"] == "3 validated gaps"


def test_preamble_renders_and_empty(monkeypatch):
    _db(monkeypatch)
    import gapmap.research.brief as br
    importlib.reload(br)
    assert br.brief_preamble("t") == ""   # no brief yet
    br.set_brief("t", goal="G", constraints="", success="S", audience="")
    p = br.brief_preamble("t")
    assert "G" in p and "S" in p


def test_suggest_clarifications_no_llm(monkeypatch):
    _db(monkeypatch)
    import gapmap.research.brief as br
    importlib.reload(br)
    # force no provider
    import gapmap.analyze.providers.base as base
    monkeypatch.setattr(base, "get_provider", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no llm")))
    out = br.suggest_clarifications("t")
    assert out["skipped"] is True and out["questions"] == []
