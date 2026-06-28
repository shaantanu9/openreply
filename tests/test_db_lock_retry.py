"""Regression tests for the parallel-collect "database is locked" failure.

Root cause (2026-06-07): every external-source adapter writes to the same
`openreply.db` from a worker thread (fetch-audit row → posts → topic_posts). SQLite
permits one writer at a time; under the widened source pool (or a second process
also attached) a writer could be held past the 5s busy_timeout, and the adapters
surfaced `source:<name>: database is locked` — collecting 0 rows for that source.

Fix: a higher busy_timeout + `_retry_on_locked` backoff on every write, and
audit-log writes (`log_fetch_start`/`log_fetch_end`) made non-fatal so a lock can
never abort a real data fetch.
"""
from __future__ import annotations

import sqlite3
import threading
import time

import pytest


def test_is_locked_err_classifies_transient_locks():
    from openreply.core.db import _is_locked_err

    assert _is_locked_err(sqlite3.OperationalError("database is locked"))
    assert _is_locked_err(sqlite3.OperationalError("database table is locked"))
    assert _is_locked_err(sqlite3.OperationalError("disk I/O error"))
    assert _is_locked_err(RuntimeError("... database is locked ..."))  # re-wrapped
    # Non-lock errors must NOT be treated as retryable.
    assert not _is_locked_err(sqlite3.OperationalError("no such table: posts"))
    assert not _is_locked_err(ValueError("nope"))


def test_retry_on_locked_succeeds_after_transient_failures(monkeypatch):
    from openreply.core import db

    monkeypatch.setattr(db, "_DB_RETRY_BASE_SLEEP", 0.0)  # no real sleeping
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise sqlite3.OperationalError("database is locked")
        return "ok"

    assert db._retry_on_locked(flaky) == "ok"
    assert calls["n"] == 3


def test_retry_on_locked_reraises_non_lock_immediately(monkeypatch):
    from openreply.core import db

    monkeypatch.setattr(db, "_DB_RETRY_BASE_SLEEP", 0.0)
    calls = {"n": 0}

    def boom():
        calls["n"] += 1
        raise sqlite3.OperationalError("no such table: posts")

    with pytest.raises(sqlite3.OperationalError):
        db._retry_on_locked(boom)
    assert calls["n"] == 1  # not retried


def test_retry_on_locked_reraises_after_exhausting_attempts(monkeypatch):
    from openreply.core import db

    monkeypatch.setattr(db, "_DB_RETRY_BASE_SLEEP", 0.0)
    monkeypatch.setattr(db, "_DB_RETRY_ATTEMPTS", 3)
    calls = {"n": 0}

    def always_locked():
        calls["n"] += 1
        raise sqlite3.OperationalError("database is locked")

    with pytest.raises(sqlite3.OperationalError):
        db._retry_on_locked(always_locked)
    assert calls["n"] == 3


def test_log_fetch_start_survives_a_held_write_lock(tmp_path, monkeypatch):
    """A concurrently-held write lock that releases within the busy_timeout must
    NOT propagate as 'database is locked' — log_fetch_start returns a real id."""
    monkeypatch.setenv("OPENREPLY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENREPLY_SKIP_PALACE", "1")
    monkeypatch.setenv("OPENREPLY_DB_BUSY_TIMEOUT_MS", "8000")

    from openreply.core.db import get_db, log_fetch_start, log_fetch_end

    get_db.cache_clear()
    db = get_db()  # creates schema + the `fetches` table
    db_path = db.conn.execute("PRAGMA database_list").fetchall()[0][2]

    hold = 0.6  # held well under the 8s busy_timeout
    released = threading.Event()

    def hold_writer():
        conn = sqlite3.connect(db_path, timeout=10, isolation_level=None)
        conn.execute("PRAGMA busy_timeout=10000")
        conn.execute("BEGIN IMMEDIATE")  # take the single write lock
        conn.execute(
            "INSERT INTO fetches(kind, params_json, started_at, rows) "
            "VALUES('holder','{}',?,0)",
            (time.strftime("%Y-%m-%dT%H:%M:%S"),),
        )
        time.sleep(hold)
        conn.execute("COMMIT")
        conn.close()
        released.set()

    t = threading.Thread(target=hold_writer)
    t.start()
    time.sleep(0.05)  # ensure the holder grabbed the lock first

    # This call blocks on the busy_timeout (and/or retries) until the holder
    # commits, then succeeds. Pre-fix (5s timeout + no retry) it could raise.
    fid = log_fetch_start("source:test", {"k": "v"})
    assert fid is not None and fid >= 0
    log_fetch_end(fid, rows=7)

    t.join()
    assert released.is_set()

    row = db.conn.execute(
        "SELECT rows, error FROM fetches WHERE id=?", (fid,)
    ).fetchone()
    assert row == (7, None)


def test_log_fetch_start_returns_sentinel_when_write_persistently_fails(monkeypatch):
    """If the audit write can never complete, log_fetch_start must degrade to -1
    (never raise) so the adapter proceeds to fetch + persist real data."""
    from openreply.core import db

    monkeypatch.setattr(db, "_DB_RETRY_BASE_SLEEP", 0.0)
    monkeypatch.setattr(db, "_DB_RETRY_ATTEMPTS", 2)

    class _AlwaysLockedTable:
        def insert(self, *_a, **_k):
            raise sqlite3.OperationalError("database is locked")

    class _FakeDB:
        def __getitem__(self, _name):
            return _AlwaysLockedTable()

    monkeypatch.setattr(db, "get_db", lambda: _FakeDB())

    assert db.log_fetch_start("source:test", {}) == -1
    # And the matching end-call is a safe no-op on the sentinel.
    db.log_fetch_end(-1, rows=0, error="x")
