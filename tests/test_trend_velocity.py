"""Unit tests for research.trend_velocity — recent vs prior posting rate."""
from __future__ import annotations

import time
from pathlib import Path

import pytest


def test_window_velocity_rising():
    from gapmap.research.trend_velocity import _window_velocity
    now = time.time()
    day = 86400.0
    # 5 posts in last 7d, 1 in the prior 7d.
    created = [now - day] * 5 + [now - 10 * day]
    v = _window_velocity(created, 7)
    assert v["recent"] == 5 and v["prior"] == 1
    assert v["direction"] == "rising"
    assert v["velocity_pct"] > 0


def test_window_velocity_new_has_no_baseline():
    from gapmap.research.trend_velocity import _window_velocity
    now = time.time()
    created = [now - 86400.0] * 3  # all recent, none prior
    v = _window_velocity(created, 7)
    assert v["direction"] == "new"
    assert v["velocity_pct"] is None


def test_window_velocity_falling():
    from gapmap.research.trend_velocity import _window_velocity
    now = time.time()
    day = 86400.0
    created = [now - day] + [now - 9 * day] * 6
    v = _window_velocity(created, 7)
    assert v["direction"] == "falling"
    assert v["velocity_pct"] < 0


def test_keywords_drops_stopwords():
    from gapmap.research.trend_velocity import _keywords
    kw = _keywords("Flight tracking app issues")
    assert "app" not in kw and "issues" not in kw
    assert "flight" in kw and "tracking" in kw


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    from gapmap.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db = db_mod.get_db()
    now = time.time()
    day = 86400.0
    db["posts"].insert_all([
        {"id": "a", "title": "flight tracking is broken", "selftext": "",
         "created_utc": now - day, "source_type": "reddit"},
        {"id": "b", "title": "flight tracking woes", "selftext": "",
         "created_utc": now - 2 * day, "source_type": "reddit"},
        {"id": "c", "title": "old flight tracking gripe", "selftext": "",
         "created_utc": now - 10 * day, "source_type": "reddit"},
    ], pk="id")
    db["topic_posts"].insert_all([
        {"topic": "t", "post_id": "a"}, {"topic": "t", "post_id": "b"},
        {"topic": "t", "post_id": "c"},
    ], pk=("topic", "post_id"))
    return db


def test_topic_velocity_counts(db):
    from gapmap.research import trend_velocity
    v = trend_velocity.compute_topic_velocity("t", window_days=7)
    assert v["ok"] and v["total_posts"] == 3
    assert v["recent"] == 2 and v["prior"] == 1


def test_gap_velocity_matches_keywords(db):
    from gapmap.research import trend_velocity
    # Seed a scored gap so compute_gap_velocity has something to match.
    db.execute(
        "INSERT INTO gap_scores(topic,gap_id,title,pain_score) VALUES(?,?,?,?)",
        ["t", "flight-tracking", "Flight tracking", 60.0],
    ) if "gap_scores" in db.table_names() else None
    # Ensure table exists via pain_scoring then insert.
    from gapmap.research import pain_scoring
    pain_scoring._ensure_table()
    db.execute(
        "INSERT OR REPLACE INTO gap_scores(topic,gap_id,title,pain_score) VALUES(?,?,?,?)",
        ["t", "flight-tracking", "Flight tracking", 60.0],
    )
    db.conn.commit()
    r = trend_velocity.compute_gap_velocity("t", gap_id="flight-tracking")
    assert r["ok"] is True
    assert r["matched"] == 3  # all 3 posts mention "flight"/"tracking"
