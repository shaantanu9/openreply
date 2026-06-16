"""Append-only, SHA-256 hash-chained provenance ledger for academic mode.

Every stage of the academic-mode pipeline (collect → analyse → gaps →
peer-review → integrity → citation-check → brief) can drop a "passport"
entry here: a tamper-evident receipt of what it produced. Entries are
chained — each one's `entry_hash` folds in the *previous* entry's hash —
so once a run is written you can later prove the chain hasn't been edited,
re-ordered, or had a stage silently dropped. Think of it as a material
passport for a research artefact: an auditable lineage you can verify
after the fact.

Design choices:
- This module owns its OWN sqlite table (`academic_passport`) and creates
  it idempotently via `_ensure_table`. We deliberately do NOT touch
  `db.py::init_schema` so two parallel feature branches can't collide on
  the same migration block.
- Every public function is BEST-EFFORT. A provenance ledger must never be
  the thing that takes down a user-facing research run, so DB errors are
  caught and returned as `{"ok": False, "error": ...}` rather than raised.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db


# ── Constants ──────────────────────────────────────────────────────────────
_TABLE = "academic_passport"
# Sentinel prev_hash for the first entry of a run. Using a non-empty marker
# (rather than "") makes a genesis row visually obvious in the raw table.
_GENESIS = "GENESIS"


def _utc_now() -> str:
    """Second-precision UTC timestamp, matching the rest of the codebase."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _canonical(payload: Any) -> str:
    """Deterministic JSON encoding of a payload for hashing.

    sort_keys + tight separators + `default=str` give us a stable byte
    string regardless of dict insertion order or the odd non-JSON value
    (datetime, Path, etc.) sneaking into a stage payload.
    """
    return json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))


def _compute_hash(prev_hash: str, seq: int, stage: str, payload_canonical: str) -> str:
    """The one true chain formula — keep encoder + order identical everywhere.

        entry_hash = sha256( prev_hash | seq | stage | payload_canonical )

    Folding `prev_hash` in is what makes the structure a *chain*: flip any
    earlier entry and every downstream hash stops matching.
    """
    material = prev_hash + "|" + str(seq) + "|" + stage + "|" + payload_canonical
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _ensure_table(db: Any) -> None:
    """Create the passport table + indexes if they don't exist yet.

    Mirrors the create/create_index style used in db.py::init_schema. `id`
    is an int pk that sqlite_utils auto-increments on insert, so callers
    never have to manage row identity — the (run_id, seq) pair is the
    logical key, and we look up the running seq per run_id at append time.
    """
    if _TABLE not in db.table_names():
        db[_TABLE].create(
            {
                "id": int,
                "topic": str,
                "run_id": str,
                "seq": int,
                "stage": str,
                "payload_json": str,
                "prev_hash": str,
                "entry_hash": str,
                "ts": str,
            },
            pk="id",
        )
        # run_id: fetch / verify a single chain. topic: find the latest run.
        db[_TABLE].create_index(["run_id"])
        db[_TABLE].create_index(["topic"])


def _resolve_db(db: Any) -> Any:
    """Use the caller-supplied Database (tests) or fall back to get_db()."""
    return db if db is not None else get_db()


# ── Public API ─────────────────────────────────────────────────────────────
def append_passport(
    topic: str,
    run_id: str,
    stage: str,
    payload: dict,
    *,
    db: Any = None,
) -> dict:
    """Append one tamper-evident entry to a run's provenance chain.

    Looks up the current max `seq` for this run_id (default -1 → first
    entry is seq 0), pulls the previous entry's `entry_hash` to chain
    against, computes this entry's hash, and inserts the row.

    Returns the written entry summary
    `{seq, stage, prev_hash, entry_hash, ts}` on success, or
    `{"ok": False, "error": ...}` on any failure. Never raises.
    """
    try:
        database = _resolve_db(db)
        _ensure_table(database)

        # Current tail of this run's chain. seq is monotonic per run_id.
        prev_seq = -1
        prev_hash = _GENESIS
        rows = list(
            database[_TABLE].rows_where(
                "run_id = ?", [run_id], order_by="seq desc", select="seq, entry_hash"
            )
        )
        if rows:
            tail = rows[0]
            prev_seq = int(tail["seq"])
            prev_hash = tail["entry_hash"]

        seq = prev_seq + 1
        ts = _utc_now()
        payload_canonical = _canonical(payload)
        entry_hash = _compute_hash(prev_hash, seq, stage, payload_canonical)

        database[_TABLE].insert(
            {
                "topic": topic,
                "run_id": run_id,
                "seq": seq,
                "stage": stage,
                "payload_json": payload_canonical,
                "prev_hash": prev_hash,
                "entry_hash": entry_hash,
                "ts": ts,
            }
        )

        return {
            "ok": True,
            "seq": seq,
            "stage": stage,
            "prev_hash": prev_hash,
            "entry_hash": entry_hash,
            "ts": ts,
        }
    except Exception as e:  # noqa: BLE001 — ledger must never crash a run
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def get_passport(
    topic: str | None = None,
    run_id: str | None = None,
    *,
    db: Any = None,
) -> dict:
    """Fetch a run's chain, payloads hydrated back to dicts, with a verdict.

    Resolution order:
      - `run_id` given → return exactly that run's chain.
      - else `topic` given → return the LATEST run_id's chain for the topic
        (latest = the run whose newest entry has the highest ts/seq).

    The returned dict carries a `verified` flag computed by running the
    chain back through `verify_passport`, so a caller gets provenance +
    integrity in a single call.
    """
    try:
        database = _resolve_db(db)
        _ensure_table(database)

        resolved_run_id = run_id
        if resolved_run_id is None:
            if topic is None:
                return {"ok": False, "error": "must supply topic or run_id", "entries": []}
            resolved_run_id = _latest_run_id_for_topic(database, topic)
            if resolved_run_id is None:
                # No runs for this topic yet — graceful empty, not an error.
                return {"ok": True, "run_id": None, "entries": [], "verified": False}

        entries = []
        for row in database[_TABLE].rows_where(
            "run_id = ?", [resolved_run_id], order_by="seq asc"
        ):
            entries.append(
                {
                    "seq": int(row["seq"]),
                    "stage": row["stage"],
                    "payload": _hydrate(row["payload_json"]),
                    "prev_hash": row["prev_hash"],
                    "entry_hash": row["entry_hash"],
                    "ts": row["ts"],
                }
            )

        # An empty chain verifies as vacuously valid, but for a caller asking
        # "is this run's provenance verified?" an empty/unknown run should read
        # as not-verified — there's nothing to attest to.
        verdict = verify_passport(resolved_run_id, db=database)
        verified = bool(entries) and bool(verdict.get("valid"))
        return {
            "ok": True,
            "run_id": resolved_run_id,
            "entries": entries,
            "verified": verified,
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "entries": []}


def verify_passport(run_id: str, *, db: Any = None) -> dict:
    """Recompute a run's chain and report whether it's intact.

    Walks the entries in seq order and checks two invariants per entry:
      1. `entry_hash` recomputes from (prev_hash, seq, stage, payload_json).
      2. `prev_hash` equals the previous entry's `entry_hash`
         (genesis must point at the GENESIS sentinel).

    Returns `{"ok", "valid", "broken_at", "length"}`. `broken_at` is the
    seq of the first entry that fails either invariant, else None.
    """
    try:
        database = _resolve_db(db)
        _ensure_table(database)

        rows = list(
            database[_TABLE].rows_where("run_id = ?", [run_id], order_by="seq asc")
        )
        length = len(rows)
        if length == 0:
            # Nothing to verify; an empty chain is vacuously valid.
            return {"ok": True, "valid": True, "broken_at": None, "length": 0}

        expected_prev = _GENESIS
        for row in rows:
            seq = int(row["seq"])
            stage = row["stage"]
            payload_canonical = row["payload_json"]
            stored_prev = row["prev_hash"]
            stored_hash = row["entry_hash"]

            # Link check: this entry must point at the prior entry's hash.
            if stored_prev != expected_prev:
                return {"ok": True, "valid": False, "broken_at": seq, "length": length}

            # Integrity check: the stored hash must recompute from its parts.
            recomputed = _compute_hash(stored_prev, seq, stage, payload_canonical)
            if recomputed != stored_hash:
                return {"ok": True, "valid": False, "broken_at": seq, "length": length}

            expected_prev = stored_hash

        return {"ok": True, "valid": True, "broken_at": None, "length": length}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "valid": False, "broken_at": None, "length": 0, "error": f"{type(e).__name__}: {e}"}


# ── Internal helpers ───────────────────────────────────────────────────────
def _hydrate(payload_json: str) -> Any:
    """Turn a stored canonical payload string back into a Python object.

    Tolerant: if a row was hand-edited into invalid JSON, we surface the
    raw string rather than blowing up the whole get_passport call.
    """
    try:
        return json.loads(payload_json) if payload_json else {}
    except Exception:  # noqa: BLE001
        return {"_raw": payload_json}


def _latest_run_id_for_topic(db: Any, topic: str) -> str | None:
    """The run_id of the most recent entry for a topic, or None.

    "Most recent" is decided by (ts, seq) descending so a freshly appended
    run wins over older ones even if rows interleave on disk.
    """
    rows = list(
        db[_TABLE].rows_where(
            "topic = ?", [topic], order_by="ts desc, seq desc", select="run_id", limit=1
        )
    )
    return rows[0]["run_id"] if rows else None
