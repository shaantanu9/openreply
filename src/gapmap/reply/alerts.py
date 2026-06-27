"""Alert rules — when to ping on high-value mentions (Slack/email).

Per-agent rules stored in `reply_alerts`. A rule fires when a found opportunity meets its
intent/score threshold; the actual push transport (Slack webhook / email) is a later
milestone — for now this is the rule store + matcher the Inbox/Alerts UI reads.
"""
from __future__ import annotations

import hashlib
import time

from .agent import active_id
from .schema import init_reply_schema


def _ensure(db):
    if "reply_alerts" not in set(db.table_names()):
        db["reply_alerts"].create(
            {
                "id": str, "agent_id": str, "rule": str, "channel": str,
                "intent_min": str, "score_min": float, "status": str, "created_at": int,
            },
            pk="id",
        )
        db["reply_alerts"].create_index(["agent_id"])
    return db


def list_alerts(agent_id: str | None = None) -> list[dict]:
    db = _ensure(init_reply_schema())
    aid = agent_id or active_id() or "default"
    return [dict(r) for r in db["reply_alerts"].rows_where("agent_id = ?", [aid], order_by="created_at desc")]


def add_alert(rule: str, channel: str = "email", intent_min: str = "any",
              score_min: float = 0.0, agent_id: str | None = None) -> dict:
    db = _ensure(init_reply_schema())
    aid = agent_id or active_id() or "default"
    now = int(time.time())
    rid = hashlib.sha1(f"{aid}|{rule}|{now}".encode()).hexdigest()[:12]
    rec = {
        "id": rid, "agent_id": aid, "rule": rule, "channel": channel,
        "intent_min": intent_min, "score_min": float(score_min), "status": "on", "created_at": now,
    }
    db["reply_alerts"].insert(rec, pk="id")
    return rec


def delete_alert(alert_id: str) -> bool:
    db = _ensure(init_reply_schema())
    try:
        db["reply_alerts"].delete(alert_id)
        return True
    except Exception:
        return False


def matching_alerts(opp: dict, agent_id: str | None = None) -> list[dict]:
    """Which active rules a given opportunity would fire (score threshold)."""
    out = []
    for a in list_alerts(agent_id):
        if a.get("status") != "on":
            continue
        if float(opp.get("score") or 0) >= float(a.get("score_min") or 0):
            out.append(a)
    return out
