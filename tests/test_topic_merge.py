"""Tests for arbitrary two-topic merge (topic_resolver.merge_topics)."""
from pathlib import Path

import pytest

from openreply.core import db as db_mod


@pytest.fixture
def clean_db(tmp_path: Path, monkeypatch):
    """Isolated temp DB per test — canonical pattern (see test_smoke.py::db).

    CRITICAL: the data-dir env var is OPENREPLY_DATA_DIR (core/config.py
    _resolve_data_dir). The legacy REDDIT_MYIND_DATA_DIR is NOT honored;
    using it silently falls through to the REAL app database, so these
    tests would run against — and mutate — production data. Always
    OPENREPLY_DATA_DIR + cache_clear(), then assert the attached file is the
    temp one before doing anything.
    """
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    db_mod.get_db.cache_clear()
    db = db_mod.get_db()
    db_mod.init_schema(db)
    # Hard isolation guard — sqlite_utils.Database has no .path, so read the
    # actually-attached file. Abort before any write if it's not the temp DB.
    attached = list(db.conn.execute("PRAGMA database_list"))[0][2]
    assert str(tmp_path) in attached, f"test DB not isolated! attached={attached}"
    yield db
    db_mod.get_db.cache_clear()


def _seed(db):
    """Two topics: src{p1,p2}, dst{p2,p3} — p2 is shared (a duplicate)."""
    for pid in ("p1", "p2", "p3"):
        db["posts"].insert({"id": pid, "title": f"post {pid}"}, pk="id", replace=True)
    rows = [
        {"topic": "src", "post_id": "p1", "source": "reddit", "added_at": "t"},
        {"topic": "src", "post_id": "p2", "source": "reddit", "added_at": "t"},
        {"topic": "dst", "post_id": "p2", "source": "reddit", "added_at": "t"},
        {"topic": "dst", "post_id": "p3", "source": "reddit", "added_at": "t"},
    ]
    db["topic_posts"].insert_all(rows, pk=("topic", "post_id"), replace=True)
    db["graph_nodes"].insert_all([
        {"id": "n1", "topic": "src", "kind": "concept", "label": "a"},
        {"id": "n2", "topic": "src", "kind": "concept", "label": "b"},
        {"id": "n3", "topic": "dst", "kind": "concept", "label": "c"},
    ], pk="id", replace=True)
    db["topic_prefs"].insert({"topic": "src"}, pk="topic", replace=True)
    db["topic_prefs"].insert({"topic": "dst"}, pk="topic", replace=True)


def _count(db, table, topic):
    return next(db.query(
        f"SELECT count(*) AS n FROM {table} WHERE topic = ?", [topic]
    ))["n"]


def test_dry_run_does_not_mutate(clean_db):
    from openreply.research.topic_resolver import merge_topics
    _seed(clean_db)

    out = merge_topics("src", "dst", apply=False)
    assert out["ok"] is True
    assert out["dry_run"] is True
    assert out["source_posts"] == 2
    assert out["target_posts"] == 2
    assert out["duplicate_posts_skipped"] == 1   # p2 already in dst
    assert out["posts_to_move"] == 1             # only p1 is new
    assert out["nodes_to_move"] == 2

    # Nothing actually moved.
    assert _count(clean_db, "topic_posts", "src") == 2
    assert _count(clean_db, "topic_posts", "dst") == 2


def test_apply_repoints_and_dedupes(clean_db):
    from openreply.research.topic_resolver import merge_topics
    _seed(clean_db)

    out = merge_topics("src", "dst", apply=True)
    assert out["ok"] is True
    assert out["merged"] is True

    # Source fully drained.
    assert _count(clean_db, "topic_posts", "src") == 0
    assert _count(clean_db, "graph_nodes", "src") == 0
    assert _count(clean_db, "topic_prefs", "src") == 0

    # Target has all 3 distinct posts (p2 not double-counted) + all 3 nodes.
    assert _count(clean_db, "topic_posts", "dst") == 3
    assert _count(clean_db, "graph_nodes", "dst") == 3


def test_self_merge_rejected(clean_db):
    from openreply.research.topic_resolver import merge_topics
    _seed(clean_db)
    out = merge_topics("src", "src", apply=True)
    assert out["ok"] is False
    assert "itself" in out["error"]


def test_missing_source_rejected(clean_db):
    from openreply.research.topic_resolver import merge_topics
    _seed(clean_db)
    out = merge_topics("nope", "dst", apply=True)
    assert out["ok"] is False
    assert "not found" in out["error"]


def test_empty_args_rejected(clean_db):
    from openreply.research.topic_resolver import merge_topics
    assert merge_topics("", "dst")["ok"] is False
    assert merge_topics("src", "")["ok"] is False
