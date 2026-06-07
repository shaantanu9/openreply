"""Unit tests for research.gap_audience — the people-to-reach rollup.

Seeds a gap_scores row + posts, builds the audience, and checks dedup by
author, engagement ranking, topic-wide rollup, and graceful empty handling.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    from gapmap.core import db as db_mod
    db_mod.get_db.cache_clear()  # type: ignore[attr-defined]
    db = db_mod.get_db()
    db["posts"].insert_all([
        {"id": "p1", "title": "t1", "author": "alice", "permalink": "/r/x/p1",
         "score": 100, "num_comments": 5, "source_type": "reddit"},
        {"id": "p2", "title": "t2", "author": "bob", "permalink": "/r/x/p2",
         "score": 10, "num_comments": 1, "source_type": "reddit"},
        {"id": "p3", "title": "t3", "author": "[deleted]", "permalink": "/r/x/p3",
         "score": 999, "num_comments": 9, "source_type": "reddit"},
    ], pk="id")
    # Seed scored gaps that point at those posts.
    from gapmap.research import pain_scoring
    pain_scoring._ensure_table()
    db.execute(
        "INSERT INTO gap_scores(topic,gap_id,title,sample_post_ids,pain_score)"
        " VALUES(?,?,?,?,?)",
        ["t", "gap-a", "Gap A", json.dumps(["p1", "p2", "p3"]), 80.0],
    )
    db.execute(
        "INSERT INTO gap_scores(topic,gap_id,title,sample_post_ids,pain_score)"
        " VALUES(?,?,?,?,?)",
        ["t", "gap-b", "Gap B", json.dumps(["p1"]), 50.0],
    )
    db.conn.commit()
    return db


def test_build_dedupes_and_skips_deleted(db):
    from gapmap.research import gap_audience
    r = gap_audience.build("t")
    assert r["ok"] is True
    # alice + bob; [deleted] excluded. alice appears in both gaps.
    assert r["people"] == 2
    gap_a = gap_audience.get_gap_users("t", "gap-a")
    authors = {x["author"] for x in gap_a["rows"]}
    assert authors == {"alice", "bob"}
    assert "[deleted]" not in authors


def test_engagement_ranking(db):
    from gapmap.research import gap_audience
    gap_audience.build("t")
    rows = gap_audience.get_gap_users("t", "gap-a")["rows"]
    # alice (105) ranks above bob (11).
    assert rows[0]["author"] == "alice"
    assert rows[0]["engagement"] >= rows[1]["engagement"]


def test_topic_reachout_dedupes_across_gaps(db):
    from gapmap.research import gap_audience
    gap_audience.build("t")
    out = gap_audience.get_topic_reachout("t")
    by_author = {x["author"]: x for x in out["rows"]}
    # alice voiced both gaps → gap_count 2.
    assert by_author["alice"]["gap_count"] == 2
    assert by_author["bob"]["gap_count"] == 1


def test_build_without_scores_is_graceful(db):
    from gapmap.research import gap_audience
    r = gap_audience.build("unknown-topic")
    assert r["ok"] is False
    assert gap_audience.get_topic_reachout("unknown-topic")["count"] == 0
