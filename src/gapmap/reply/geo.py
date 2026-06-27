"""AI Visibility (GEO) — track queries where the brand should be cited in Google/LLM answers.

Reddit is the #1 cited source in AI answers, so replying on the threads those queries
surface is how a brand gets into AI answers. Tracked queries + their citation status
live in `geo_queries`; `check_query` runs an **automated** visibility check via the
configured BYOK provider — it asks the model the query (as the chosen surface would
answer it), captures the answer, and classifies the brand as cited / competitor /
absent. Each check is appended to `geo_checks` so the page can show a trend.
"""
from __future__ import annotations

import hashlib
import json
import time

from ..analyze.providers.base import get_provider
from .agent import active_id, get_agent
from .schema import init_reply_schema

SURFACES = ("ChatGPT", "Perplexity", "Google")
STATUSES = ("tracking", "cited", "competitor", "absent")


def _ensure(db):
    if "geo_queries" not in set(db.table_names()):
        db["geo_queries"].create(
            {
                "id": str, "agent_id": str, "query": str, "surface": str,
                "status": str, "answer": str, "competitors": str,
                "last_checked": int, "created_at": int,
            },
            pk="id",
        )
        db["geo_queries"].create_index(["agent_id"])
    else:
        # Migrate older tables: add the captured-answer columns in place.
        cols = set(db["geo_queries"].columns_dict)
        for c in ("answer", "competitors"):
            if c not in cols:
                db["geo_queries"].add_column(c, str)
    if "geo_checks" not in set(db.table_names()):
        db["geo_checks"].create(
            {
                "id": str, "query_id": str, "agent_id": str, "status": str,
                "answer": str, "competitors": str, "checked_at": int,
            },
            pk="id",
        )
        db["geo_checks"].create_index(["query_id"])
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


def _parse_json(text: str) -> dict:
    """Tolerant JSON extraction from an LLM response (handles ```json fences)."""
    t = (text or "").strip()
    if "```" in t:
        t = t.split("```")[1] if t.count("```") >= 2 else t
        if t.lstrip().lower().startswith("json"):
            t = t.lstrip()[4:]
    i, j = t.find("{"), t.rfind("}")
    if i != -1 and j != -1 and j > i:
        t = t[i:j + 1]
    try:
        return json.loads(t)
    except Exception:
        return {}


def _classify(brand: str, answer: str, recs: list[str]) -> tuple[str, list[str]]:
    """cited if the brand shows up; else competitor if rivals were named; else absent.
    Returns (status, competitors-excluding-our-brand)."""
    b = (brand or "").strip().lower()
    recs = [r for r in (recs or []) if r and r.strip()]
    ans_l = (answer or "").lower()
    cited = bool(b) and (b in ans_l or any(b in r.lower() for r in recs))
    competitors = [r for r in recs if not (b and b in r.lower())]
    if cited:
        return "cited", competitors
    if competitors:
        return "competitor", competitors
    return "absent", competitors


def check_query(qid: str, provider: str | None = None) -> dict:
    """Automated visibility check: ask the model the query and detect citation."""
    db = _ensure(init_reply_schema())
    rows = list(db["geo_queries"].rows_where("id = ?", [qid], limit=1))
    if not rows:
        return {"error": f"no tracked query '{qid}'"}
    q = rows[0]
    agent = get_agent(q.get("agent_id")) or {}
    brand = agent.get("brand") or agent.get("name") or ""
    surface = q.get("surface") or "ChatGPT"
    sys = (
        f"You are {surface}, answering a user's question the way that assistant would. "
        "Recommend SPECIFIC named tools, brands, products, or sources — be honest and "
        "concrete, do not hedge. Output ONLY JSON: "
        '{"answer": "<2-4 sentence answer naming specific options>", '
        '"recommendations": ["<brand/tool/source>", ...]}'
    )
    prompt = f'User question: "{q["query"]}"'
    try:
        raw = get_provider(provider).complete(prompt, system=sys, max_tokens=600, temperature=0.4)
    except Exception as e:
        return {"error": f"check failed (LLM not configured?): {e}"}

    data = _parse_json(raw)
    answer = (data.get("answer") or raw or "").strip()
    recs = data.get("recommendations") or []
    if not isinstance(recs, list):
        recs = [str(recs)]
    status, competitors = _classify(brand, answer, recs)

    now = int(time.time())
    comp_json = json.dumps(competitors, ensure_ascii=False)
    db["geo_queries"].update(qid, {
        "status": status, "answer": answer, "competitors": comp_json, "last_checked": now,
    })
    db["geo_checks"].insert({
        "id": hashlib.sha1(f"{qid}|{now}".encode()).hexdigest()[:14],
        "query_id": qid, "agent_id": q.get("agent_id") or "", "status": status,
        "answer": answer, "competitors": comp_json, "checked_at": now,
    }, pk="id")
    return {**q, "status": status, "answer": answer,
            "competitors": competitors, "last_checked": now, "brand": brand}


def check_all(agent_id: str | None = None, provider: str | None = None) -> dict:
    """Re-check every tracked query for the agent. Returns a per-status tally."""
    db = _ensure(init_reply_schema())
    aid = agent_id or active_id() or "default"
    ids = [r["id"] for r in db["geo_queries"].rows_where("agent_id = ?", [aid])]
    results, tally = [], {"cited": 0, "competitor": 0, "absent": 0, "error": 0}
    for qid in ids:
        r = check_query(qid, provider=provider)
        if r.get("error"):
            tally["error"] += 1
        else:
            tally[r.get("status", "absent")] = tally.get(r.get("status", "absent"), 0) + 1
        results.append(r)
    return {"checked": len(ids), "tally": tally, "results": results}


def query_history(qid: str, limit: int = 60) -> dict:
    """Past checks for one query (oldest→newest) for the trend sparkline."""
    db = _ensure(init_reply_schema())
    rows = [dict(r) for r in db["geo_checks"].rows_where(
        "query_id = ?", [qid], order_by="checked_at asc", limit=limit)]
    return {"query_id": qid, "checks": rows}


def delete_query(qid: str) -> bool:
    db = _ensure(init_reply_schema())
    try:
        db["geo_queries"].delete(qid)
        return True
    except Exception:
        return False
