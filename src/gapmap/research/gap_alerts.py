"""Gap alerts — saved monitoring that fires when a gap moves.

Recurring value is what turns a one-off research tool into a habit (and a
subscription): tell Gap Map "watch this" and it notifies you when a gap spikes,
goes new, or crosses a pain-score threshold. Conditions are evaluated against
the pain-score + velocity passes we already have — no LLM.

Alert types:
  - ``spike``           : velocity_pct ≥ threshold (default 50) and rising.
  - ``new``             : a gap with no prior-window baseline appears.
  - ``score_threshold`` : a gap's pain_score ≥ threshold (default 70).

Two tables: ``gap_alerts`` (the saved watches) and ``gap_alert_events`` (the
fired history). ``check_alerts`` is safe to run on a schedule (jobs/cron).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db

ALERT_TYPES = ("spike", "new", "score_threshold")
_DEFAULT_THRESHOLD = {"spike": 50.0, "new": 0.0, "score_threshold": 70.0}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ensure_tables() -> None:
    db = get_db()
    db.execute(
        "CREATE TABLE IF NOT EXISTS gap_alerts ("
        " alert_id TEXT PRIMARY KEY,"
        " topic TEXT NOT NULL,"
        " gap_id TEXT,"               # NULL = whole topic
        " alert_type TEXT NOT NULL,"
        " threshold REAL,"
        " window_days INTEGER DEFAULT 7,"
        " frequency TEXT DEFAULT 'daily',"
        " enabled INTEGER DEFAULT 1,"
        " last_checked_at TEXT,"
        " last_triggered_at TEXT,"
        " created_at TEXT)"
    )
    db.execute(
        "CREATE TABLE IF NOT EXISTS gap_alert_events ("
        " event_id TEXT PRIMARY KEY,"
        " alert_id TEXT NOT NULL,"
        " topic TEXT NOT NULL,"
        " gap_id TEXT,"
        " kind TEXT,"
        " detail TEXT,"
        " value REAL,"
        " created_at TEXT)"
    )
    db.conn.commit()


def create_alert(topic: str, alert_type: str, *, gap_id: str | None = None,
                 threshold: float | None = None, window_days: int = 7,
                 frequency: str = "daily") -> dict[str, Any]:
    _ensure_tables()
    if alert_type not in ALERT_TYPES:
        return {"ok": False, "error": f"alert_type must be one of {ALERT_TYPES}"}
    if threshold is None:
        threshold = _DEFAULT_THRESHOLD[alert_type]
    alert_id = uuid.uuid4().hex[:12]
    db = get_db()
    db.execute(
        "INSERT INTO gap_alerts(alert_id,topic,gap_id,alert_type,threshold,"
        "window_days,frequency,enabled,created_at) VALUES(?,?,?,?,?,?,?,1,?)",
        [alert_id, topic, gap_id, alert_type, float(threshold),
         int(window_days), frequency, _now()],
    )
    db.conn.commit()
    return {"ok": True, "alert_id": alert_id, "topic": topic,
            "alert_type": alert_type, "gap_id": gap_id, "threshold": threshold}


def list_alerts(topic: str | None = None) -> dict[str, Any]:
    _ensure_tables()
    db = get_db()
    if topic:
        rows = list(db.query(
            "SELECT * FROM gap_alerts WHERE topic = ? ORDER BY created_at DESC", [topic]))
    else:
        rows = list(db.query("SELECT * FROM gap_alerts ORDER BY created_at DESC"))
    for r in rows:
        r["enabled"] = bool(r.get("enabled"))
    return {"ok": True, "count": len(rows), "rows": rows}


def update_alert(alert_id: str, *, enabled: bool | None = None,
                 threshold: float | None = None,
                 frequency: str | None = None) -> dict[str, Any]:
    _ensure_tables()
    db = get_db()
    sets, params = [], []
    if enabled is not None:
        sets.append("enabled = ?"); params.append(1 if enabled else 0)
    if threshold is not None:
        sets.append("threshold = ?"); params.append(float(threshold))
    if frequency is not None:
        sets.append("frequency = ?"); params.append(frequency)
    if not sets:
        return {"ok": False, "error": "nothing to update"}
    params.append(alert_id)
    db.execute(f"UPDATE gap_alerts SET {', '.join(sets)} WHERE alert_id = ?", params)
    db.conn.commit()
    return {"ok": True, "alert_id": alert_id}


def delete_alert(alert_id: str) -> dict[str, Any]:
    _ensure_tables()
    db = get_db()
    db.execute("DELETE FROM gap_alerts WHERE alert_id = ?", [alert_id])
    db.execute("DELETE FROM gap_alert_events WHERE alert_id = ?", [alert_id])
    db.conn.commit()
    return {"ok": True, "alert_id": alert_id}


def _record_event(alert_id: str, topic: str, gap_id: str | None,
                  kind: str, detail: str, value: float | None) -> dict:
    db = get_db()
    event_id = uuid.uuid4().hex[:12]
    db.execute(
        "INSERT INTO gap_alert_events(event_id,alert_id,topic,gap_id,kind,detail,"
        "value,created_at) VALUES(?,?,?,?,?,?,?,?)",
        [event_id, alert_id, topic, gap_id, kind, detail, value, _now()],
    )
    return {"event_id": event_id, "alert_id": alert_id, "topic": topic,
            "gap_id": gap_id, "kind": kind, "detail": detail, "value": value}


def _evaluate(alert: dict) -> dict | None:
    """Return an event dict if the alert condition is met, else None."""
    from . import trend_velocity
    topic = alert["topic"]
    gap_id = alert.get("gap_id")
    atype = alert["alert_type"]
    threshold = alert.get("threshold") or _DEFAULT_THRESHOLD.get(atype, 0.0)
    window = int(alert.get("window_days") or 7)

    if atype == "score_threshold":
        db = get_db()
        where = "WHERE topic = ?"
        params: list[Any] = [topic]
        if gap_id:
            where += " AND gap_id = ?"; params.append(gap_id)
        rows = list(db.query(
            f"SELECT gap_id, title, pain_score FROM gap_scores {where}"
            f" ORDER BY pain_score DESC LIMIT 1", params))
        if rows and (rows[0]["pain_score"] or 0) >= threshold:
            r = rows[0]
            return _record_event(alert["alert_id"], topic, r["gap_id"],
                                  "score_threshold",
                                  f"{r['title']} pain {r['pain_score']} ≥ {threshold}",
                                  r["pain_score"])
        return None

    # spike / new use velocity
    if gap_id:
        v = trend_velocity.compute_gap_velocity(topic, gap_id=gap_id, window_days=window)
    else:
        v = trend_velocity.compute_topic_velocity(topic, window_days=window)
    if not v.get("ok"):
        return None
    direction = v.get("direction")
    vpct = v.get("velocity_pct")
    if atype == "new" and direction == "new":
        return _record_event(alert["alert_id"], topic, gap_id, "new",
                             f"{gap_id or topic} is new (no prior baseline)", None)
    if atype == "spike" and direction == "rising" and vpct is not None and vpct >= threshold:
        return _record_event(alert["alert_id"], topic, gap_id, "spike",
                             f"{gap_id or topic} +{vpct}% ≥ {threshold}%", vpct)
    return None


def check_alerts(topic: str | None = None) -> dict[str, Any]:
    """Evaluate all enabled alerts (optionally for one topic). Records events
    for any that fire. Safe to run on a schedule. Returns {ok, checked, fired}."""
    _ensure_tables()
    db = get_db()
    alerts = list_alerts(topic)["rows"]
    fired: list[dict] = []
    checked = 0
    for a in alerts:
        if not a.get("enabled"):
            continue
        checked += 1
        ev = None
        try:
            ev = _evaluate(a)
        except Exception:
            ev = None
        now = _now()
        if ev:
            db.execute(
                "UPDATE gap_alerts SET last_checked_at=?, last_triggered_at=? WHERE alert_id=?",
                [now, now, a["alert_id"]])
            fired.append(ev)
        else:
            db.execute("UPDATE gap_alerts SET last_checked_at=? WHERE alert_id=?",
                       [now, a["alert_id"]])
    db.conn.commit()
    return {"ok": True, "checked": checked, "fired": len(fired), "events": fired}


def list_events(topic: str | None = None, limit: int = 50) -> dict[str, Any]:
    _ensure_tables()
    db = get_db()
    if topic:
        rows = list(db.query(
            "SELECT * FROM gap_alert_events WHERE topic = ? ORDER BY created_at DESC LIMIT ?",
            [topic, int(limit)]))
    else:
        rows = list(db.query(
            "SELECT * FROM gap_alert_events ORDER BY created_at DESC LIMIT ?", [int(limit)]))
    return {"ok": True, "count": len(rows), "rows": rows}


__all__ = ["create_alert", "list_alerts", "update_alert", "delete_alert",
           "check_alerts", "list_events", "ALERT_TYPES"]
