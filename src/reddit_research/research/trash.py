"""Soft-delete for topics (T1.3).

Delete Topic previously blasted topic_posts + graph_nodes + graph_edges.
Users who mis-type the confirm string or change their mind lost the entire
corpus + graph + bets. Now:

  * `soft_delete(topic)` stamps `topic_prefs.deleted_at` with ISO timestamp.
    list_topics + the graph hide the topic as if gone.
  * `restore(topic)` clears `deleted_at` — topic reappears everywhere.
  * `list_trash()` shows everything currently soft-deleted with age.
  * `purge_older_than(min_age_days=7)` hard-deletes trash rows older than
    7 days. Called by a launchd nightly sweep OR manually from Settings
    (→ "Empty trash now").

Hard-delete still runs when a topic has no topic_prefs row (edge case:
graph-only topic with nothing in topic_prefs). Without a stash row we
can't tombstone, so preserving the old behavior there is the least
surprising choice.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta
from typing import Any

from ..core.db import get_db, init_schema


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def soft_delete(topic: str) -> dict[str, Any]:
    if not topic:
        return {"ok": False, "error": "empty topic"}
    db = get_db()
    init_schema(db)
    now = _utc_now()
    # Ensure a prefs row exists so we have somewhere to stash the tombstone.
    db.conn.execute(
        "INSERT INTO topic_prefs (topic, scheduled, last_run_seen, last_run_ts, deleted_at) "
        "VALUES (?, 0, '', ?, ?) "
        "ON CONFLICT(topic) DO UPDATE SET deleted_at=excluded.deleted_at",
        (topic, now, now),
    )
    db.conn.commit()
    # Count what's hidden (diagnostic for UI)
    try:
        post_count = next(db.query(
            "SELECT count(*) AS n FROM topic_posts WHERE topic = ?", [topic]
        ))["n"]
    except Exception:
        post_count = 0
    try:
        graph_nodes = next(db.query(
            "SELECT count(*) AS n FROM graph_nodes WHERE topic = ?", [topic]
        ))["n"]
    except Exception:
        graph_nodes = 0
    return {
        "ok": True, "topic": topic, "deleted_at": now,
        "hidden_posts": post_count, "hidden_graph_nodes": graph_nodes,
        "recoverable_until": (datetime.now(timezone.utc) + timedelta(days=7))
            .isoformat(timespec="seconds"),
    }


def restore(topic: str) -> dict[str, Any]:
    if not topic:
        return {"ok": False, "error": "empty topic"}
    db = get_db()
    init_schema(db)
    db.conn.execute(
        "UPDATE topic_prefs SET deleted_at = '' WHERE topic = ?",
        (topic,),
    )
    db.conn.commit()
    return {"ok": True, "topic": topic, "restored_at": _utc_now()}


def list_trash() -> list[dict]:
    db = get_db()
    if "topic_prefs" not in db.table_names():
        return []
    cols = {c.name for c in db["topic_prefs"].columns}
    if "deleted_at" not in cols:
        return []
    rows = list(db.query(
        "SELECT topic, deleted_at, last_run_ts FROM topic_prefs "
        "WHERE deleted_at IS NOT NULL AND deleted_at != '' "
        "ORDER BY deleted_at DESC"
    ))
    # Enrich with post count + age_days for the UI
    now_dt = datetime.now(timezone.utc)
    for r in rows:
        try:
            r["post_count"] = next(db.query(
                "SELECT count(*) AS n FROM topic_posts WHERE topic = ?",
                [r["topic"]],
            ))["n"]
        except Exception:
            r["post_count"] = 0
        try:
            dt = datetime.fromisoformat(r["deleted_at"])
            r["age_days"] = round((now_dt - dt).total_seconds() / 86400, 1)
        except Exception:
            r["age_days"] = 0
        r["expires_in_days"] = max(0, round(7 - r["age_days"], 1))
    return rows


def purge_older_than(min_age_days: int = 7) -> dict[str, Any]:
    """Hard-delete soft-deleted topics older than `min_age_days`.

    Moves from soft → hard by running the old DELETE cascade across
    topic_posts / graph_nodes / graph_edges / hypothesis_tests /
    topic_insights / topic_runs / topic_prefs. Intended to be called by a
    nightly scheduler OR from a Settings "Empty trash now" button.
    """
    db = get_db()
    if "topic_prefs" not in db.table_names():
        return {"ok": True, "purged": 0, "reason": "no topic_prefs"}
    cols = {c.name for c in db["topic_prefs"].columns}
    if "deleted_at" not in cols:
        return {"ok": True, "purged": 0, "reason": "deleted_at column missing"}
    cutoff_dt = datetime.now(timezone.utc) - timedelta(days=max(0, int(min_age_days)))
    cutoff = cutoff_dt.isoformat(timespec="seconds")
    victims = [r["topic"] for r in db.query(
        "SELECT topic FROM topic_prefs "
        "WHERE deleted_at IS NOT NULL AND deleted_at != '' AND deleted_at < ?",
        [cutoff],
    )]
    if not victims:
        return {"ok": True, "purged": 0, "topics": []}

    placeholders = ",".join(["?"] * len(victims))
    # All tables that carry a topic column. Guarded — some may not exist
    # on older installs (hypothesis_tests is a late-Phase-3 addition).
    tables = [
        "topic_posts", "graph_nodes", "graph_edges",
        "topic_insights", "topic_runs", "hypothesis_tests", "topic_prefs",
    ]
    for tbl in tables:
        if tbl not in db.table_names():
            continue
        try:
            db.conn.execute(
                f"DELETE FROM {tbl} WHERE topic IN ({placeholders})",
                victims,
            )
        except Exception:
            # Some tables may not have a `topic` column in older schemas;
            # swallow and continue.
            pass
    db.conn.commit()
    return {"ok": True, "purged": len(victims), "topics": victims,
            "min_age_days": min_age_days, "cutoff": cutoff}


__all__ = ["soft_delete", "restore", "list_trash", "purge_older_than"]
