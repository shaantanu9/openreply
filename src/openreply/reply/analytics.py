"""OpenReply Analytics — one server-side aggregation over the agent's activity.

`analytics_summary` rolls up `reply_opportunities` + `content_items` (+ the geo
citation rate) into KPIs, a 30-day daily time series, content performance, and
the subreddit / keyword drivers. The Tauri Analytics page renders this verbatim
with inline-SVG charts — no aggregation in the frontend.
"""
from __future__ import annotations

import time

from .agent import get_active_agent, get_agent
from .schema import init_reply_schema

_DAY = 86400


def _rows(db, table, where, args):
    try:
        return [dict(r) for r in db[table].rows_where(where, args)]
    except Exception:
        return []


def _daybucket(ts: int) -> int:
    """Floor an epoch to UTC midnight."""
    return int(ts) - (int(ts) % _DAY)


def _series(days: int, events: list[tuple[int, str]]) -> dict:
    """Build day-keyed counts for the last `days` days across named event streams.
    `events` = list of (timestamp, stream_name). Returns
    {labels:[epoch…], streams:{name:[count per day…]}}."""
    today = _daybucket(int(time.time()))
    start = today - (days - 1) * _DAY
    labels = [start + i * _DAY for i in range(days)]
    idx = {d: i for i, d in enumerate(labels)}
    names = sorted({n for _, n in events})
    streams = {n: [0] * days for n in names}
    for ts, name in events:
        if not ts:
            continue
        d = _daybucket(ts)
        if d in idx:
            streams[name][idx[d]] += 1
    return {"labels": labels, "streams": streams}


def _top(counts: dict, limit: int = 8) -> list[dict]:
    return [{"label": k, "count": v} for k, v in
            sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:limit]]


def analytics_summary(agent_id: str | None = None, days: int = 30) -> dict:
    a = get_agent(agent_id) if agent_id else get_active_agent()
    if not a:
        return {"error": "no active agent — create one first"}
    db = init_reply_schema()
    bid = a["id"]

    opps = _rows(db, "reply_opportunities", "brand_id = ?", [bid])
    content = _rows(db, "content_items", "agent_id = ?", [bid])

    def cnt(arr, key, val):
        return sum(1 for x in arr if (x.get(key) or "") == val)

    # KPIs ------------------------------------------------------------------
    kpis = {
        "opportunities": len(opps),
        "saved": cnt(opps, "status", "saved"),
        "drafted": cnt(opps, "status", "drafted"),
        "replied": cnt(opps, "status", "posted"),
        "dismissed": cnt(opps, "status", "skipped"),
        "content_total": len(content),
        "content_drafts": cnt(content, "status", "draft"),
        "content_scheduled": cnt(content, "status", "scheduled"),
        "content_posted": cnt(content, "status", "posted"),
    }
    try:
        from . import geo as _geo
        kpis["citation_rate"] = _geo.list_queries(bid).get("citation_rate", 0)
    except Exception:
        kpis["citation_rate"] = 0

    # 30-day time series ----------------------------------------------------
    events: list[tuple[int, str]] = []
    for o in opps:
        events.append((o.get("found_at") or 0, "opportunities"))
    for c in content:
        events.append((c.get("created_at") or 0, "content"))
        if c.get("posted_at"):
            events.append((c.get("posted_at"), "posted"))
    series = _series(days, events)

    # Content performance ---------------------------------------------------
    by_kind: dict = {}
    for c in content:
        k = (c.get("kind") or "—").replace("_", " ")
        by_kind[k] = by_kind.get(k, 0) + 1
    funnel = {
        "draft": kpis["content_drafts"],
        "scheduled": kpis["content_scheduled"],
        "posted": kpis["content_posted"],
    }

    # Drivers ---------------------------------------------------------------
    by_sub, by_platform = {}, {}
    for o in opps:
        s = o.get("sub") or "—"
        by_sub[s] = by_sub.get(s, 0) + 1
        p = o.get("platform") or "—"
        by_platform[p] = by_platform.get(p, 0) + 1

    by_keyword: dict = {}
    for kw in (a.get("keywords") or []):
        k = kw.lower().strip()
        if not k:
            continue
        by_keyword[kw] = sum(
            1 for o in opps
            if k in ((o.get("title") or "") + " " + (o.get("body") or "")).lower()
        )

    return {
        "agent": {"id": bid, "name": a.get("name")},
        "days": days,
        "kpis": kpis,
        "series": series,
        "content_by_kind": _top(by_kind, 12),
        "funnel": funnel,
        "by_subreddit": _top(by_sub, 8),
        "by_platform": _top(by_platform, 8),
        "by_keyword": _top(by_keyword, 12),
    }
