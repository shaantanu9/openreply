"""Unit tests for the incremental-enrichment extraction queue + worker.

Task 1 scope: schema creation for extraction_queue table. Subsequent tasks
will expand this file with tests for _tag_posts enqueue (Task 2) and the
drain loop (Task 3).
"""
from __future__ import annotations


def test_schema_creates_queue(tmp_path, monkeypatch):
    """init_schema() must create extraction_queue with the expected columns
    and indexes. Guards against the worker booting against a missing table."""
    monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", str(tmp_path))

    # Force re-read of env-configured db_path — the per-thread cache from
    # other tests would otherwise return a stale DB handle.
    from reddit_research.core.db import get_db

    get_db.cache_clear()
    db = get_db()

    assert "extraction_queue" in db.table_names()
    cols = {c.name for c in db["extraction_queue"].columns}
    expected = {
        "topic",
        "post_id",
        "kind",
        "queued_at",
        "attempted_at",
        "attempts",
        "last_error",
    }
    assert expected <= cols, f"missing columns: {expected - cols}"

    # Composite PK (topic, post_id, kind) — enforced via sqlite-utils defaults;
    # verify by checking pk via sqlite_master pragma.
    pk_cols = {c.name for c in db["extraction_queue"].columns if c.is_pk}
    assert pk_cols == {"topic", "post_id", "kind"}, (
        f"extraction_queue PK should be (topic, post_id, kind); got {pk_cols}"
    )
