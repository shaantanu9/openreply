"""Unit tests for research.gap_digest — the scheduled brief assembly."""
from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db = db_mod.get_db()
    from openreply.research import pain_scoring
    pain_scoring._ensure_table()
    db.execute(
        "INSERT INTO gap_scores(topic,gap_id,title,pain_score,frequency,severity,sample_post_ids)"
        " VALUES(?,?,?,?,?,?,?)",
        ["t", "g1", "Top gap", 88.0, 9, "high", json.dumps([])],
    )
    db.conn.commit()
    return db


def test_digest_has_sections_and_markdown(db):
    from openreply.research import gap_digest
    r = gap_digest.build_digest("t", period="daily")
    assert r["ok"] is True
    assert "OpenReply digest" in r["markdown"]
    assert "Top gap" in r["markdown"]          # top gap surfaces
    assert "Top gaps by pain" in r["markdown"]
    assert set(["top_gaps", "rising", "people", "alerts"]).issubset(r["sections"].keys())


def test_digest_period_label(db):
    from openreply.research import gap_digest
    r = gap_digest.build_digest("t", period="weekly")
    assert r["period"] == "weekly"
    assert "Weekly brief" in r["markdown"]


def test_digest_empty_topic_is_graceful(db):
    from openreply.research import gap_digest
    r = gap_digest.build_digest("nope", period="daily")
    assert r["ok"] is True
    assert "No scored gaps yet" in r["markdown"]
