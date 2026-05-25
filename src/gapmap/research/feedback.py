"""Finding-level user feedback (T2.4).

When a user 👎 a finding the synthesize LLM surfaced, we persist that
verdict to the `finding_feedback` table (created in core/db.py::init_schema).
On the next synthesize call for that topic, those flagged titles are
injected into the prompt as a negative-examples block — a lightweight
in-context correction that doesn't require fine-tuning or RAG.

Schema (read-only reference — managed by core/db.py, do not touch):
    id, topic, finding_title, finding_kind, verdict, note, created_at

Verdicts:
    wrong       — the claim itself is incorrect given the corpus
    off_topic   — not relevant to the topic scope
    spam        — low-signal/marketing noise the LLM picked up
    ok          — positive ack (future use — not injected into prompt)
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db

# Verdicts that flow into the negative-examples block. 'ok' is reserved for
# future positive-reinforcement signalling and is NOT sent to the LLM.
_NEGATIVE_VERDICTS = ("wrong", "off_topic", "spam")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def record_feedback(
    topic: str,
    title: str,
    kind: str,
    verdict: str,
    note: str = "",
) -> dict[str, Any]:
    """Persist one user feedback row. Returns the created row as a dict.

    No UNIQUE constraint on (topic, title) — callers may tag the same
    finding multiple times if they want to record evolving opinion. The
    `feedback_for_prompt` reader dedupes by title so only the most recent
    verdict per title is surfaced to the LLM.
    """
    topic = (topic or "").strip()
    title = (title or "").strip()
    kind = (kind or "").strip() or "painpoint"
    verdict = (verdict or "").strip().lower()
    if not topic or not title:
        return {"ok": False, "error": "topic and title are required"}
    if verdict not in (*_NEGATIVE_VERDICTS, "ok"):
        return {"ok": False,
                "error": f"verdict must be one of wrong/off_topic/spam/ok (got {verdict!r})"}
    db = get_db()
    if "finding_feedback" not in db.table_names():
        # Defensive — should be pre-created by core/db.py::init_schema. If
        # we hit this the user's DB predates T2.4's schema update; surface
        # the reason rather than silently failing.
        return {
            "ok": False,
            "error": "finding_feedback table missing — run the app once to "
                     "trigger schema init, or reinstall.",
        }
    row = {
        "topic": topic,
        "finding_title": title,
        "finding_kind": kind,
        "verdict": verdict,
        "note": (note or "").strip(),
        "created_at": _now_iso(),
    }
    db["finding_feedback"].insert(row, pk="id")
    return {"ok": True, "feedback": row}


def feedback_for_prompt(topic: str, limit: int = 10) -> dict[str, list[str]]:
    """Return negative feedback grouped by verdict for prompt injection.

    Only the latest verdict per (topic, title) is kept — if a user first
    marked "wrong" then later "off_topic", the off_topic entry wins. This
    avoids contradictory instructions in the prompt.

    Output shape matches what `insights.synthesize_insights` splices into
    the negative-examples section:

        {
          "wrong":      ["title A", "title B", ...],
          "off_topic":  ["title C", ...],
          "spam":       ["title D", ...],
        }

    Titles are capped per bucket by `limit` to bound prompt size. `ok`
    verdicts are excluded — those are for future positive signalling.
    """
    out: dict[str, list[str]] = {v: [] for v in _NEGATIVE_VERDICTS}
    topic = (topic or "").strip()
    if not topic:
        return out
    db = get_db()
    if "finding_feedback" not in db.table_names():
        return out
    # Pull ALL rows for the topic, sorted newest-first. We dedupe in
    # Python because SQLite's window functions aren't universally enabled
    # on older bundled drivers and the volume here (<< 1000 per topic)
    # doesn't justify the portability hit.
    rows = list(db.query(
        "SELECT finding_title, verdict, created_at FROM finding_feedback "
        "WHERE topic = ? ORDER BY created_at DESC",
        [topic],
    ))
    seen: set[str] = set()
    for r in rows:
        title = (r.get("finding_title") or "").strip()
        verdict = (r.get("verdict") or "").strip().lower()
        if not title or verdict not in _NEGATIVE_VERDICTS:
            continue
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        bucket = out[verdict]
        if len(bucket) < limit:
            bucket.append(title)
    return out


__all__ = ["record_feedback", "feedback_for_prompt"]
