"""Pricing & quantitative survey instruments.

Three instruments share `survey_responses` (kind = vw|nps|maxdiff):

  - **Van Westendorp PSM** (Van Westendorp, 1976, ESOMAR Congress).
    Four price questions per respondent: too_expensive, too_cheap,
    expensive_but_acceptable, bargain. The intersections of the price
    distributions reveal the optimal price (OPP), indifference price
    (IPP), and the acceptable range (PMC – PME).

  - **Net Promoter Score** (Reichheld, 2003, HBR). Single 0–10
    "would you recommend" question. NPS = %promoters − %detractors.

  - **MaxDiff (Maximum Difference Scaling)** — best/worst pairs across
    feature sets. Aggregated into a stable feature ranking that resists
    Likert inflation.

All three persist responses to `survey_responses.data_json` keyed by
`kind`, then aggregate on demand.
"""
from __future__ import annotations

import json
import re
import statistics
from datetime import datetime, timezone
from typing import Any, Optional

from ..core.db import get_db, init_schema


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _new_id(kind: str, topic: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (topic or "").lower()).strip("-") or kind
    return f"{kind}-{base}-{int(datetime.now().timestamp() * 1000)}"


# ── Van Westendorp ──────────────────────────────────────────────────────
def add_vw_response(
    topic: str,
    *,
    too_expensive: float,
    too_cheap: float,
    expensive_but_acceptable: float,
    bargain: float,
    product_id: str = "",
    respondent: str = "",
    persona: str = "",
    notes: str = "",
) -> dict[str, Any]:
    db = get_db()
    init_schema(db)

    def _f(x):
        try:
            return float(x or 0)
        except (TypeError, ValueError):
            return 0.0

    payload = {
        "too_expensive": max(0.0, _f(too_expensive)),
        "too_cheap": max(0.0, _f(too_cheap)),
        "expensive_but_acceptable": max(0.0, _f(expensive_but_acceptable)),
        "bargain": max(0.0, _f(bargain)),
        "notes": (notes or "")[:300],
    }
    rid = _new_id("vw", topic)
    now = _utc_now()
    db["survey_responses"].upsert({
        "id": rid,
        "topic": (topic or "").strip(),
        "product_id": (product_id or "").strip(),
        "kind": "vw",
        "respondent": (respondent or "")[:120],
        "persona": (persona or "")[:80],
        "data_json": json.dumps(payload),
        "responded_at": now,
        "created_at": now,
    }, pk="id")
    return {"ok": True, "id": rid, "data": payload}


def vw_aggregate(topic: str, product_id: str = "") -> dict[str, Any]:
    """Compute OPP, IPP, PMC, PME from collected responses.

    OPP (Optimal Price Point): intersection of "too cheap" and "too
    expensive" cumulative curves — minimizes price resistance.
    IPP (Indifference Price Point): intersection of "expensive_but_acceptable"
    and "bargain" curves — point of equal positive vs negative perception.
    PMC (lower bound, "Point of Marginal Cheapness"): intersection of
    "too cheap" with "expensive_but_acceptable".
    PME (upper bound, "Point of Marginal Expensiveness"): intersection
    of "bargain" with "too expensive".
    """
    db = get_db()
    if "survey_responses" not in db.table_names():
        return {"ok": True, "n": 0}
    if product_id:
        rows = list(db.query(
            "SELECT data_json FROM survey_responses WHERE kind = 'vw' AND product_id = ?",
            [product_id],
        ))
    else:
        rows = list(db.query(
            "SELECT data_json FROM survey_responses WHERE kind = 'vw' AND topic = ?",
            [topic],
        ))
    if not rows:
        return {"ok": True, "n": 0}
    series = {"too_expensive": [], "too_cheap": [], "expensive_but_acceptable": [], "bargain": []}
    for r in rows:
        try:
            d = json.loads(r.get("data_json") or "{}") or {}
        except Exception:
            d = {}
        for k in series:
            v = d.get(k)
            try:
                if v is not None:
                    series[k].append(float(v))
            except (TypeError, ValueError):
                pass

    n = len(rows)
    if not series["too_expensive"] or not series["too_cheap"]:
        return {"ok": True, "n": n}

    # Build cumulative (or reverse-cumulative) at fine price grid.
    all_prices = sorted(set(p for arr in series.values() for p in arr))
    if not all_prices:
        return {"ok": True, "n": n}
    lo, hi = min(all_prices), max(all_prices)
    if hi <= lo:
        hi = lo + 1
    step = max((hi - lo) / 80, 0.01)
    grid = []
    p = lo
    while p <= hi + 1e-9:
        grid.append(round(p, 4))
        p += step

    def _cum_le(arr, x):
        return sum(1 for v in arr if v <= x) / len(arr) if arr else 0.0

    def _cum_ge(arr, x):
        return sum(1 for v in arr if v >= x) / len(arr) if arr else 0.0

    curves = {
        # too_cheap is a "cheap-side" curve — % feeling it's too cheap at price x decreases with x
        "too_cheap": [(x, _cum_ge(series["too_cheap"], x)) for x in grid],
        # bargain — % thinking it's a bargain at x (decreasing in x)
        "bargain": [(x, _cum_ge(series["bargain"], x)) for x in grid],
        # expensive_but_acceptable — increasing in x
        "expensive_but_acceptable": [(x, _cum_le(series["expensive_but_acceptable"], x)) for x in grid],
        # too_expensive — increasing in x
        "too_expensive": [(x, _cum_le(series["too_expensive"], x)) for x in grid],
    }

    def _intersect(a_curve, b_curve):
        prev = None
        for (xa, ya), (xb, yb) in zip(a_curve, b_curve):
            if prev is not None:
                pxa, pya, pxb, pyb = prev
                # sign change in (a - b)
                if (pya - pyb) * (ya - yb) <= 0:
                    # Linear interpolate within this step
                    da = (pya - pyb)
                    db_ = (ya - yb)
                    if (db_ - da) == 0:
                        return (xa + pxa) / 2
                    t = da / (da - db_)
                    return pxa + t * (xa - pxa)
            prev = (xa, ya, xb, yb)
        return None

    opp = _intersect(curves["too_cheap"], curves["too_expensive"])
    ipp = _intersect(curves["bargain"], curves["expensive_but_acceptable"])
    pmc = _intersect(curves["too_cheap"], curves["expensive_but_acceptable"])
    pme = _intersect(curves["bargain"], curves["too_expensive"])

    return {
        "ok": True,
        "n": n,
        "opp": round(opp, 2) if opp is not None else None,
        "ipp": round(ipp, 2) if ipp is not None else None,
        "pmc": round(pmc, 2) if pmc is not None else None,
        "pme": round(pme, 2) if pme is not None else None,
        "median": {k: statistics.median(v) for k, v in series.items() if v},
        "samples": {k: len(v) for k, v in series.items()},
    }


# ── Net Promoter Score ──────────────────────────────────────────────────
def add_nps_response(
    topic: str,
    *,
    score: int,
    product_id: str = "",
    respondent: str = "",
    persona: str = "",
    reason: str = "",
) -> dict[str, Any]:
    db = get_db()
    init_schema(db)
    try:
        s = int(score)
    except (TypeError, ValueError):
        s = 0
    s = max(0, min(s, 10))
    payload = {"score": s, "reason": (reason or "")[:600]}
    rid = _new_id("nps", topic)
    now = _utc_now()
    db["survey_responses"].upsert({
        "id": rid,
        "topic": (topic or "").strip(),
        "product_id": (product_id or "").strip(),
        "kind": "nps",
        "respondent": (respondent or "")[:120],
        "persona": (persona or "")[:80],
        "data_json": json.dumps(payload),
        "responded_at": now,
        "created_at": now,
    }, pk="id")
    return {"ok": True, "id": rid, "score": s}


def nps_score(topic: str, product_id: str = "") -> dict[str, Any]:
    db = get_db()
    if "survey_responses" not in db.table_names():
        return {"ok": True, "n": 0}
    if product_id:
        rows = list(db.query(
            "SELECT data_json FROM survey_responses WHERE kind='nps' AND product_id = ?",
            [product_id],
        ))
    else:
        rows = list(db.query(
            "SELECT data_json FROM survey_responses WHERE kind='nps' AND topic = ?",
            [topic],
        ))
    if not rows:
        return {"ok": True, "n": 0}
    promoters = passives = detractors = 0
    for r in rows:
        try:
            d = json.loads(r.get("data_json") or "{}") or {}
        except Exception:
            d = {}
        s = int(d.get("score") or 0)
        if s >= 9:
            promoters += 1
        elif s >= 7:
            passives += 1
        else:
            detractors += 1
    n = promoters + passives + detractors
    nps = (promoters / n * 100) - (detractors / n * 100) if n else 0
    return {
        "ok": True, "n": n,
        "promoters": promoters,
        "passives": passives,
        "detractors": detractors,
        "nps": round(nps, 1),
    }


# ── MaxDiff ─────────────────────────────────────────────────────────────
def add_maxdiff_response(
    topic: str,
    *,
    set_id: str,
    best: str,
    worst: str,
    options: list[str],
    product_id: str = "",
    respondent: str = "",
    persona: str = "",
) -> dict[str, Any]:
    db = get_db()
    init_schema(db)
    payload = {
        "set_id": str(set_id or "")[:60],
        "best": str(best or "").strip()[:120],
        "worst": str(worst or "").strip()[:120],
        "options": [str(x).strip()[:120] for x in (options or []) if str(x).strip()],
    }
    rid = _new_id("maxdiff", topic)
    now = _utc_now()
    db["survey_responses"].upsert({
        "id": rid,
        "topic": (topic or "").strip(),
        "product_id": (product_id or "").strip(),
        "kind": "maxdiff",
        "respondent": (respondent or "")[:120],
        "persona": (persona or "")[:80],
        "data_json": json.dumps(payload),
        "responded_at": now,
        "created_at": now,
    }, pk="id")
    return {"ok": True, "id": rid, "data": payload}


def maxdiff_ranking(topic: str, product_id: str = "") -> dict[str, Any]:
    """Aggregate best/worst counts per option → simple BW score
    (best - worst) / appearances. Rank features by score."""
    db = get_db()
    if "survey_responses" not in db.table_names():
        return {"ok": True, "n": 0, "ranking": []}
    if product_id:
        rows = list(db.query(
            "SELECT data_json FROM survey_responses WHERE kind='maxdiff' AND product_id = ?",
            [product_id],
        ))
    else:
        rows = list(db.query(
            "SELECT data_json FROM survey_responses WHERE kind='maxdiff' AND topic = ?",
            [topic],
        ))
    if not rows:
        return {"ok": True, "n": 0, "ranking": []}
    best_n: dict[str, int] = {}
    worst_n: dict[str, int] = {}
    appear: dict[str, int] = {}
    for r in rows:
        try:
            d = json.loads(r.get("data_json") or "{}") or {}
        except Exception:
            d = {}
        for o in (d.get("options") or []):
            appear[o] = appear.get(o, 0) + 1
        b = d.get("best")
        w = d.get("worst")
        if b:
            best_n[b] = best_n.get(b, 0) + 1
        if w:
            worst_n[w] = worst_n.get(w, 0) + 1
    items = []
    for opt, n in appear.items():
        b = best_n.get(opt, 0)
        w = worst_n.get(opt, 0)
        score_ = (b - w) / max(n, 1)
        items.append({
            "option": opt, "n_seen": n, "best": b, "worst": w,
            "bw_score": round(score_, 3),
        })
    items.sort(key=lambda x: -x["bw_score"])
    return {"ok": True, "n": len(rows), "ranking": items}


# ── Convenience: pull all survey responses for a slice ─────────────────
def list_responses(
    topic: str = "",
    product_id: str = "",
    kind: str = "",
) -> list[dict[str, Any]]:
    db = get_db()
    if "survey_responses" not in db.table_names():
        return []
    where = []
    args: list[Any] = []
    if topic:
        where.append("topic = ?"); args.append(topic)
    if product_id:
        where.append("product_id = ?"); args.append(product_id)
    if kind:
        where.append("kind = ?"); args.append(kind)
    sql = "SELECT * FROM survey_responses"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY responded_at DESC LIMIT 500"
    out = []
    for r in db.query(sql, args):
        try:
            r["data"] = json.loads(r.get("data_json") or "{}") or {}
        except Exception:
            r["data"] = {}
        out.append(r)
    return out


def delete_response(response_id: str) -> dict[str, Any]:
    db = get_db()
    if "survey_responses" not in db.table_names():
        return {"ok": False, "error": "survey_responses missing"}
    db["survey_responses"].delete_where("id = ?", [response_id])
    return {"ok": True, "deleted": response_id}


__all__ = [
    "add_vw_response", "vw_aggregate",
    "add_nps_response", "nps_score",
    "add_maxdiff_response", "maxdiff_ranking",
    "list_responses", "delete_response",
]
