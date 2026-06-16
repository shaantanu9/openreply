"""Tests for the append-only hash-chained academic provenance ledger.

These use a REAL sqlite_utils Database (a tmp-file DB) passed in via the
`db=` kwarg, so the hash chain is genuinely exercised end-to-end — append,
verify, tamper-detect, hydrate, and the unknown-run edge case.
"""
from __future__ import annotations

import hashlib

import pytest
import sqlite_utils

from gapmap.research.academic_passport import (
    append_passport,
    get_passport,
    verify_passport,
    _compute_hash,
    _canonical,
)


@pytest.fixture()
def db(tmp_path):
    """Fresh on-disk sqlite_utils Database for each test (clean chain)."""
    return sqlite_utils.Database(str(tmp_path / "passport.db"))


def test_append_three_stages_links_chain(db):
    """seq increments 0,1,2 and each prev_hash == prior entry_hash."""
    run = "run-abc"
    e0 = append_passport("ml gaps", run, "collect", {"posts": 10}, db=db)
    e1 = append_passport("ml gaps", run, "analyse", {"papers": 3}, db=db)
    e2 = append_passport("ml gaps", run, "brief", {"sections": 5}, db=db)

    assert [e0["seq"], e1["seq"], e2["seq"]] == [0, 1, 2]

    # Genesis points at the sentinel; subsequent links chain.
    assert e0["prev_hash"] == "GENESIS"
    assert e1["prev_hash"] == e0["entry_hash"]
    assert e2["prev_hash"] == e1["entry_hash"]

    # The recorded hash matches the documented formula independently.
    expected0 = _compute_hash("GENESIS", 0, "collect", _canonical({"posts": 10}))
    assert e0["entry_hash"] == expected0


def test_verify_untampered_chain_is_valid(db):
    run = "run-clean"
    append_passport("t", run, "collect", {"a": 1}, db=db)
    append_passport("t", run, "gaps", {"b": [1, 2, 3]}, db=db)
    append_passport("t", run, "brief", {"c": {"nested": True}}, db=db)

    v = verify_passport(run, db=db)
    assert v["ok"] is True
    assert v["valid"] is True
    assert v["broken_at"] is None
    assert v["length"] == 3


def test_tampering_payload_breaks_verification(db):
    run = "run-tamper"
    append_passport("t", run, "collect", {"a": 1}, db=db)
    append_passport("t", run, "gaps", {"b": 2}, db=db)
    append_passport("t", run, "brief", {"c": 3}, db=db)

    # Mutate the payload of the middle entry directly in the DB. Its stored
    # entry_hash no longer recomputes from the new payload.
    db["academic_passport"].update(
        # id of seq=1 (insertion order → id 2)
        2,
        {"payload_json": _canonical({"b": 999})},
    )

    v = verify_passport(run, db=db)
    assert v["valid"] is False
    assert v["broken_at"] == 1
    assert v["length"] == 3


def test_get_passport_by_topic_returns_latest_run_hydrated(db):
    topic = "shared-topic"
    # Older run.
    append_passport(topic, "run-old", "collect", {"v": "old"}, db=db)
    # Newer run (later ts via more entries / later insert — ts is second
    # precision, so also give it a higher seq tail to break any ts tie).
    append_passport(topic, "run-new", "collect", {"v": "new"}, db=db)
    append_passport(topic, "run-new", "brief", {"done": True}, db=db)

    got = get_passport(topic=topic, db=db)
    assert got["ok"] is True
    assert got["run_id"] == "run-new"
    assert got["verified"] is True
    # Payloads hydrated back to real dicts, ordered by seq.
    assert [e["seq"] for e in got["entries"]] == [0, 1]
    assert got["entries"][0]["payload"] == {"v": "new"}
    assert isinstance(got["entries"][0]["payload"], dict)


def test_get_passport_unknown_run_is_graceful(db):
    # Unknown run_id → ok True, empty entries (no crash).
    got = get_passport(run_id="does-not-exist", db=db)
    assert got["ok"] is True
    assert got["entries"] == []
    assert got["verified"] is False

    # Unknown topic → also graceful empty.
    got2 = get_passport(topic="never-seen", db=db)
    assert got2["ok"] is True
    assert got2["entries"] == []
