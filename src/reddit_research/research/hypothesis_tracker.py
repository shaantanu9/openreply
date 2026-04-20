"""Phase-3 Hypothesis Tracking — turn Insight Engine hypothesis cards into
stateful, trackable product bets.

A hypothesis card (produced by `research/insights.py`) is prose until the
user promotes it via `create_hypothesis_test(topic, card)`. From then on
it has a state machine (draft → running → validated | invalidated | paused
→ archived) and persists in the `hypothesis_tests` table across sessions.

The retention goal: users return weekly to update `status` + add
`resolution_notes` based on real-world test outcomes. See
docs/ROADMAP.md §"Phase 3 — Hypothesis Tracking / Decision Journal".
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db

# All valid status values. Order matches the lean-startup lifecycle
# (draft → running → resolved → archived). The UI renders pills in this order.
_VALID_STATUSES = frozenset({
    "draft",       # saved but not started
    "running",     # test in progress, started_at set
    "validated",   # test confirmed hypothesis, resolved_at set
    "invalidated", # test falsified hypothesis, resolved_at set
    "paused",      # on hold, reason in resolution_notes
    "archived",    # soft-deleted, hidden from default lists
})


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _validate_status(status: str) -> None:
    if status not in _VALID_STATUSES:
        raise ValueError(
            f"invalid status {status!r}; must be one of {sorted(_VALID_STATUSES)}"
        )


def create_hypothesis_test(
    topic: str,
    card: dict[str, Any],
    status: str = "draft",
) -> dict[str, Any]:
    """Promote a hypothesis card to a tracked bet.

    `card` is the full dict as produced by `synthesize_insights` (contains
    `we_believe`, `experiences`, `because`, `and_would`, `for`, `falsifiers`,
    `cheapest_test`, `time_box_days`, `budget_usd`). We freeze it at save
    time so re-synthesis doesn't mutate the user's tracked bet.

    Returns the full row as a dict. Raises ValueError on invalid status
    or malformed card.
    """
    _validate_status(status)
    if not isinstance(card, dict) or not card.get("we_believe"):
        raise ValueError("card missing required fields (we_believe/experiences)")

    db = get_db()
    now = _utc_now()
    row = {
        "id": uuid.uuid4().hex,
        "topic": topic,
        "card_json": json.dumps(card, ensure_ascii=False, default=str),
        "status": status,
        "started_at": now if status == "running" else None,
        "resolved_at": None,
        "resolution_notes": None,
        "linked_evidence": json.dumps([]),
        "last_updated": now,
        "created_at": now,
    }
    db["hypothesis_tests"].insert(row)
    return _hydrate(row)


def update_status(
    hypothesis_id: str,
    status: str,
    notes: str | None = None,
) -> dict[str, Any]:
    """Move a bet through the state machine. Side effects:

    - status → running: stamps started_at (unless already set)
    - status → validated / invalidated: stamps resolved_at
    - notes: appended (not replaced) to resolution_notes with timestamp,
      so the journal preserves the user's reasoning history.
    """
    _validate_status(status)
    db = get_db()
    row = _fetch(hypothesis_id)
    if row is None:
        raise ValueError(f"hypothesis {hypothesis_id!r} not found")

    now = _utc_now()
    patch: dict[str, Any] = {
        "status": status,
        "last_updated": now,
    }
    if status == "running" and not row.get("started_at"):
        patch["started_at"] = now
    if status in ("validated", "invalidated"):
        # Always stamp the latest resolution time — supports re-resolution
        # if the user first marked invalidated then flipped to validated
        # after new evidence.
        patch["resolved_at"] = now
    if notes:
        prior = row.get("resolution_notes") or ""
        sep = "\n\n---\n" if prior else ""
        patch["resolution_notes"] = f"{prior}{sep}[{now}] ({status}) {notes}"

    db["hypothesis_tests"].update(hypothesis_id, patch)
    return _hydrate(_fetch(hypothesis_id))


def add_evidence(
    hypothesis_id: str,
    kind: str,
    url: str | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    """Append an evidence entry (test result link, screenshot URL, quote).

    `kind` is free-form tagging (e.g. "landing-page-metric", "interview",
    "review", "stripe-data"). No enum — users should classify their own.
    """
    db = get_db()
    row = _fetch(hypothesis_id)
    if row is None:
        raise ValueError(f"hypothesis {hypothesis_id!r} not found")
    try:
        existing = json.loads(row.get("linked_evidence") or "[]")
    except Exception:
        existing = []
    existing.append({
        "kind": kind,
        "url": url,
        "note": note,
        "at": _utc_now(),
    })
    db["hypothesis_tests"].update(hypothesis_id, {
        "linked_evidence": json.dumps(existing, ensure_ascii=False),
        "last_updated": _utc_now(),
    })
    return _hydrate(_fetch(hypothesis_id))


def delete_hypothesis(hypothesis_id: str) -> dict[str, Any]:
    """Soft-delete by flipping status to 'archived'.

    Hard-delete is not exposed — we never want the user to lose their
    decision history. Archived rows are filtered from default `list_*`
    queries but remain recoverable.
    """
    return update_status(hypothesis_id, "archived")


def list_hypotheses(
    topic: str | None = None,
    status: str | None = None,
    include_archived: bool = False,
) -> list[dict[str, Any]]:
    """List tracked bets. Defaults to all topics, all non-archived statuses.

    UI usage patterns:
      - Dashboard "My active bets" card: list_hypotheses(status='running')
      - Per-topic Bets tab:               list_hypotheses(topic=T)
      - Filtered view:                    list_hypotheses(topic=T, status='validated')
    """
    db = get_db()
    where: list[str] = ["1=1"]
    params: list[Any] = []
    if topic is not None:
        where.append("topic = ?")
        params.append(topic)
    if status is not None:
        _validate_status(status)
        where.append("status = ?")
        params.append(status)
    elif not include_archived:
        where.append("status != 'archived'")
    sql = (
        "SELECT * FROM hypothesis_tests "
        f"WHERE {' AND '.join(where)} "
        "ORDER BY last_updated DESC"
    )
    return [_hydrate(r) for r in db.query(sql, params)]


def get_hypothesis(hypothesis_id: str) -> dict[str, Any] | None:
    """Fetch one bet by id. None if not found."""
    row = _fetch(hypothesis_id)
    return _hydrate(row) if row else None


def stats_by_topic(topic: str) -> dict[str, int]:
    """Count bets per status for a topic — drives the 'validated:2 /
    invalidated:1 / running:3' badge shown on the topic page header."""
    db = get_db()
    rows = db.query(
        "SELECT status, count(*) AS n FROM hypothesis_tests "
        "WHERE topic = ? AND status != 'archived' GROUP BY status",
        [topic],
    )
    return {r["status"]: int(r["n"]) for r in rows}


def global_stats() -> dict[str, int]:
    """Global across-topic bet counts for the dashboard overview card."""
    db = get_db()
    rows = db.query(
        "SELECT status, count(*) AS n FROM hypothesis_tests "
        "WHERE status != 'archived' GROUP BY status"
    )
    return {r["status"]: int(r["n"]) for r in rows}


# ── internals ────────────────────────────────────────────────────────


def _fetch(hypothesis_id: str) -> dict[str, Any] | None:
    db = get_db()
    rows = list(db.query(
        "SELECT * FROM hypothesis_tests WHERE id = ?",
        [hypothesis_id],
    ))
    return rows[0] if rows else None


def _hydrate(row: dict[str, Any]) -> dict[str, Any]:
    """Parse the JSON blobs back into dicts so callers get typed structures."""
    if not row:
        return row
    out = dict(row)
    try:
        out["card"] = json.loads(out.get("card_json") or "{}")
    except Exception:
        out["card"] = {}
    try:
        out["evidence"] = json.loads(out.get("linked_evidence") or "[]")
    except Exception:
        out["evidence"] = []
    return out


__all__ = [
    "create_hypothesis_test",
    "update_status",
    "add_evidence",
    "delete_hypothesis",
    "list_hypotheses",
    "get_hypothesis",
    "stats_by_topic",
    "global_stats",
]
