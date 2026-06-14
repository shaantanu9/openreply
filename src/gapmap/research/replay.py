"""Run inspector — list provenance runs (run_id from 1A's checks_ledger /
lineage) and show what each produced. Read-only; nothing re-executes."""
from __future__ import annotations
from typing import Any
from ..core.db import get_db


def list_runs(topic: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    try:
        db = get_db()
        where = "WHERE run_id IS NOT NULL AND run_id != ''"
        params: dict[str, Any] = {"lim": int(limit)}
        if topic:
            where += " AND topic = :topic"; params["topic"] = topic
        sql = (f"SELECT run_id, max(topic) AS topic, count(*) AS n_checks, "
               f"sum(passed) AS n_passed, max(ts) AS last_ts "
               f"FROM checks_ledger {where} GROUP BY run_id ORDER BY last_ts DESC LIMIT :lim")
        return list(db.query(sql, params))
    except Exception:
        return []


def get_run(run_id: str) -> dict[str, Any]:
    out: dict[str, Any] = {"run_id": run_id, "checks": [], "lineage": []}
    try:
        db = get_db()
        out["checks"] = list(db.query("SELECT * FROM checks_ledger WHERE run_id = :r ORDER BY id", {"r": run_id}))
        out["lineage"] = list(db.query("SELECT * FROM lineage WHERE produced_by = :r ORDER BY id", {"r": run_id}))
    except Exception:
        pass
    return out
