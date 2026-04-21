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


def test_tag_posts_enqueues(tmp_path, monkeypatch):
    """_tag_posts must populate extraction_queue alongside topic_posts.

    The relevance gate would otherwise filter unknown post IDs — disable it
    via the threshold env to keep the test hermetic (the gate's embedder
    pulls down chromadb + ONNX, which is out of scope for a unit test of
    the enqueue hook).
    """
    monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("GAPMAP_RELEVANCE_GATE_THRESHOLD", "0")

    from reddit_research.core.db import get_db

    get_db.cache_clear()
    # Touch the schema before inserting — init_schema runs on first get_db()
    # and creates both topic_posts and extraction_queue.
    _ = get_db()

    from reddit_research.research.collect import _tag_posts

    n = _tag_posts("meditation", ["p1", "p2", "p3"], "top:reddit:month")
    assert n == 3, f"expected 3 tagged rows, got {n}"

    db = get_db()
    rows = list(db["extraction_queue"].rows)
    assert len(rows) == 3, f"expected 3 queue rows, got {len(rows)}"
    assert all(r["topic"] == "meditation" for r in rows)
    assert {r["post_id"] for r in rows} == {"p1", "p2", "p3"}
    assert all(r["kind"] == "post" for r in rows)
    assert all(r["attempts"] == 0 for r in rows)

    # Idempotency: rerun with the same post IDs → still 3 rows, no dupes.
    n2 = _tag_posts("meditation", ["p1", "p2", "p3"], "top:reddit:year")
    assert n2 == 3
    rows2 = list(db["extraction_queue"].rows)
    assert len(rows2) == 3, (
        f"composite PK should dedupe on re-tag; got {len(rows2)} rows"
    )
