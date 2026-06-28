"""Unit tests for research.gap_alerts — CRUD + the check evaluator."""
from __future__ import annotations

import time
from pathlib import Path

import pytest


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    from openreply.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db = db_mod.get_db()
    # A scored gap above threshold for score_threshold alerts.
    from openreply.research import pain_scoring
    pain_scoring._ensure_table()
    db.execute(
        "INSERT INTO gap_scores(topic,gap_id,title,pain_score) VALUES(?,?,?,?)",
        ["t", "big-pain", "Big pain", 85.0],
    )
    # Posts so velocity-based alerts have data (a rising gap).
    now = time.time(); day = 86400.0
    db["posts"].insert_all([
        {"id": f"r{i}", "title": "flight delay pain", "created_utc": now - day,
         "source_type": "reddit"} for i in range(6)
    ] + [
        {"id": "old", "title": "flight delay pain", "created_utc": now - 10 * day,
         "source_type": "reddit"},
    ], pk="id")
    db["topic_posts"].insert_all(
        [{"topic": "t", "post_id": f"r{i}"} for i in range(6)]
        + [{"topic": "t", "post_id": "old"}], pk=("topic", "post_id"))
    db.execute(
        "INSERT INTO gap_scores(topic,gap_id,title,pain_score) VALUES(?,?,?,?)",
        ["t", "flight-delay", "Flight delay", 50.0],
    )
    db.conn.commit()
    return db


def test_create_list_delete(db):
    from openreply.research import gap_alerts
    r = gap_alerts.create_alert("t", "score_threshold", threshold=70)
    assert r["ok"] and r["alert_id"]
    aid = r["alert_id"]
    lst = gap_alerts.list_alerts("t")
    assert lst["count"] == 1 and lst["rows"][0]["alert_id"] == aid
    gap_alerts.delete_alert(aid)
    assert gap_alerts.list_alerts("t")["count"] == 0


def test_invalid_type_rejected(db):
    from openreply.research import gap_alerts
    assert gap_alerts.create_alert("t", "bogus")["ok"] is False


def test_score_threshold_fires(db):
    from openreply.research import gap_alerts
    gap_alerts.create_alert("t", "score_threshold", threshold=70)
    res = gap_alerts.check_alerts("t")
    assert res["ok"] and res["fired"] == 1
    assert res["events"][0]["kind"] == "score_threshold"
    # Event is recorded.
    assert gap_alerts.list_events("t")["count"] == 1


def test_score_threshold_does_not_fire_when_below(db):
    from openreply.research import gap_alerts
    gap_alerts.create_alert("t", "score_threshold", threshold=99)
    assert gap_alerts.check_alerts("t")["fired"] == 0


def test_spike_fires_on_rising_topic(db):
    from openreply.research import gap_alerts
    # 6 recent vs 1 prior over 7d → big rising velocity.
    gap_alerts.create_alert("t", "spike", threshold=50, window_days=7)
    res = gap_alerts.check_alerts("t")
    assert res["fired"] >= 1
    assert any(e["kind"] == "spike" for e in res["events"])


def test_disabled_alert_skipped(db):
    from openreply.research import gap_alerts
    r = gap_alerts.create_alert("t", "score_threshold", threshold=70)
    gap_alerts.update_alert(r["alert_id"], enabled=False)
    assert gap_alerts.check_alerts("t")["checked"] == 0
