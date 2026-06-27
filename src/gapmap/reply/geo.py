"""AI Visibility (GEO) — track queries where the brand should be cited in Google/LLM answers.

Reddit is the #1 cited source in AI answers, so replying on the threads those queries
surface is how a brand gets into AI answers. This stores the tracked queries + their
citation status in `geo_queries`; live citation-checking (querying ChatGPT/Perplexity/
Google) is a later milestone — for now status is set/edited manually.
"""
from __future__ import annotations

import hashlib
import time

from .agent import active_id
from .schema import init_reply_schema

SURFACES = ("ChatGPT", "Perplexity", "Google")
STATUSES = ("tracking", "cited", "competitor", "absent")


def _ensure(db):
    if "geo_queries" not in set(db.table_names()):
        db["geo_queries"].create(
            {
                "id": str, "agent_id": str, "query": str, "surface": str,
                "status": str, "last_checked": int, "created_at": int,
            },
            pk="id",
        )
        db["geo_queries"].create_index(["agent_id"])
    return db


def list_queries(agent_id: str | None = None) -> dict:
    db = _ensure(init_reply_schema())
    aid = agent_id or active_id() or "default"
    rows = [dict(r) for r in db["geo_queries"].rows_where("agent_id = ?", [aid], order_by="created_at desc")]
    cited = sum(1 for r in rows if r.get("status") == "cited")
    rate = round(100 * cited / len(rows)) if rows else 0
    return {"queries": rows, "total": len(rows), "cited": cited, "citation_rate": rate}


def add_query(query: str, surface: str = "ChatGPT", agent_id: str | None = None) -> dict:
    db = _ensure(init_reply_schema())
    aid = agent_id or active_id() or "default"
    now = int(time.time())
    qid = hashlib.sha1(f"{aid}|{query}|{surface}|{now}".encode()).hexdigest()[:12]
    rec = {
        "id": qid, "agent_id": aid, "query": query,
        "surface": surface if surface in SURFACES else "ChatGPT",
        "status": "tracking", "last_checked": 0, "created_at": now,
    }
    db["geo_queries"].insert(rec, pk="id")
    return rec


def set_status(qid: str, status: str) -> bool:
    db = _ensure(init_reply_schema())
    try:
        db["geo_queries"].update(qid, {"status": status, "last_checked": int(time.time())})
        return True
    except Exception:
        return False


def delete_query(qid: str) -> bool:
    db = _ensure(init_reply_schema())
    try:
        db["geo_queries"].delete(qid)
        return True
    except Exception:
        return False
