"""Unit tests for the incremental-enrichment extraction queue + worker.

Task 1 scope: schema creation for extraction_queue table. Subsequent tasks
will expand this file with tests for _tag_posts enqueue (Task 2) and the
drain loop (Task 3).
"""
from __future__ import annotations


def test_schema_creates_queue(tmp_path, monkeypatch):
    """init_schema() must create extraction_queue with the expected columns
    and indexes. Guards against the worker booting against a missing table."""
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))

    # Force re-read of env-configured db_path — the per-thread cache from
    # other tests would otherwise return a stale DB handle.
    from gapmap.core.db import get_db

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
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("GAPMAP_RELEVANCE_GATE_THRESHOLD", "0")

    from gapmap.core.db import get_db

    get_db.cache_clear()
    # Touch the schema before inserting — init_schema runs on first get_db()
    # and creates both topic_posts and extraction_queue.
    _ = get_db()

    from gapmap.research.collect import _tag_posts

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


def test_drain_batch_removes_on_success(tmp_path, monkeypatch):
    """_drain_batch must remove successfully-processed rows from the queue.

    We monkeypatch ``enrich_from_llm_for_posts`` to a no-op that reports
    the number of post_ids it saw — the real extractor lands in Task 4 and
    pulls an LLM provider, which is out of scope for a unit test of the
    drain loop. Queue should be empty after one batch of two rows.
    """
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))

    from gapmap.core.db import get_db

    get_db.cache_clear()
    db = get_db()

    # Prime queue with two rows. Use the sqlite-utils insert_all path so the
    # composite PK is respected and queued_at is a real string (matches
    # what _tag_posts writes in production).
    db["extraction_queue"].insert_all(
        [
            {"topic": "t", "post_id": "p1", "kind": "post", "queued_at": "2026-01-01T00:00:00", "attempts": 0},
            {"topic": "t", "post_id": "p2", "kind": "post", "queued_at": "2026-01-01T00:00:00", "attempts": 0},
        ],
        pk=("topic", "post_id", "kind"),
    )
    assert db["extraction_queue"].count == 2

    # Stub the extractor on the semantic module — the worker re-imports it
    # from that module every batch so a monkeypatch takes effect without
    # a worker restart.
    import gapmap.graph.semantic as sem

    def _fake(topic, post_ids):
        return len(post_ids)

    monkeypatch.setattr(sem, "enrich_from_llm_for_posts", _fake, raising=False)

    from gapmap.research.enrich_worker import _drain_batch

    n = _drain_batch(db)
    assert n == 2, f"expected 2 rows drained, got {n}"
    assert db["extraction_queue"].count == 0, (
        f"queue should be empty after successful drain; got {db['extraction_queue'].count} rows"
    )


def test_serve_survives_transient_read_error(tmp_path, monkeypatch):
    """A transient failure in the per-iteration work (e.g. a brief
    'database is locked' on the queue SELECT while the Rust native read-path
    hammers the same WAL during rapid tab switching) must NOT crash the
    worker.

    Regression for the supervisor "Gave up after 3 restarts in 300s" banner:
    serve()'s loop body wrapped only the batch body in try/except, leaving the
    queue SELECT (and idle count) unguarded — so a transient read error
    propagated out of serve(), the process exited non-clean, and the Rust
    supervisor counted it toward the 3-strikes give-up. serve() must instead
    catch it, emit a non-fatal enrich:error, and keep draining.
    """
    monkeypatch.setenv("GAPMAP_DATA_DIR", str(tmp_path))

    from gapmap.core.db import get_db

    get_db.cache_clear()
    _ = get_db()  # create schema

    import gapmap.research.enrich_worker as ew

    ew._stop = False

    calls = {"n": 0}

    def _flaky_drain(db):  # noqa: ANN001
        calls["n"] += 1
        if calls["n"] == 1:
            # Simulate the unguarded SELECT at the top of _drain_batch raising
            # under read contention. sqlite3.OperationalError subclasses
            # Exception, which is what the live failure surfaces as.
            raise RuntimeError("database is locked")
        # Second iteration: signal a clean stop so serve() returns.
        ew._stop = True
        return 0

    monkeypatch.setattr(ew, "_drain_batch", _flaky_drain)
    monkeypatch.setattr(ew.time, "sleep", lambda *_a, **_k: None)

    events: list[tuple[str, dict]] = []
    monkeypatch.setattr(ew, "_emit", lambda kind, **d: events.append((kind, d)))

    try:
        # On the buggy code this raises RuntimeError (worker crashes); the fix
        # must make serve() catch it and return normally.
        ew.serve()
    finally:
        ew._stop = False  # reset module-level flag for other tests

    kinds = [k for k, _ in events]
    assert "enrich:error" in kinds, (
        f"transient read error should surface as a non-fatal enrich:error; got {kinds}"
    )
    assert calls["n"] >= 2, (
        f"serve() should have retried after the transient error, not crashed; "
        f"drain was called {calls['n']}x"
    )
