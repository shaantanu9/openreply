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
import os
import time
import urllib.error
import urllib.request

from ..analyze.providers.base import get_provider
from .agent import active_id, get_agent
from .schema import init_reply_schema

SURFACES = ("ChatGPT", "Perplexity", "Google")
STATUSES = ("tracking", "cited", "competitor", "absent")

# Perplexity Sonar — the one major answer engine with a clean API that returns
# the live web sources it cited. When a key is present we use it for a REAL
# citation check; otherwise we fall back to the BYOK model's own answer.
_PPLX_URL = "https://api.perplexity.ai/chat/completions"
_PPLX_MODEL = "sonar"


def _pplx_key() -> str:
    return (os.getenv("PERPLEXITY_API_KEY") or os.getenv("PPLX_API_KEY") or "").strip()


def _domain(url: str) -> str:
    """Bare registrable host of a URL/website (drops scheme, www, path)."""
    s = (url or "").strip().lower()
    s = s.split("//")[-1]            # drop scheme
    s = s.split("/")[0].split("?")[0]  # drop path/query
    if s.startswith("www."):
        s = s[4:]
    return s


def _perplexity_sonar(query: str, key: str) -> dict:
    """Query Perplexity Sonar; return {answer, citations:[url,...]} or {error}."""
    body = json.dumps({
        "model": _PPLX_MODEL,
        "messages": [
            {"role": "system", "content": "Answer concisely and recommend specific, named sources."},
            {"role": "user", "content": query},
        ],
    }).encode()
    req = urllib.request.Request(
        _PPLX_URL, data=body, method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"error": f"perplexity HTTP {e.code}: {e.reason}"}
    except Exception as e:
        return {"error": f"perplexity request failed: {e}"}
    answer = ""
    try:
        answer = (data["choices"][0]["message"]["content"] or "").strip()
    except Exception:
        pass
    # Newer API returns `search_results:[{url,title}]`; older returns `citations:[url]`.
    cites: list[str] = []
    for sr in (data.get("search_results") or []):
        u = sr.get("url") if isinstance(sr, dict) else sr
        if u:
            cites.append(str(u))
    for u in (data.get("citations") or []):
        if u and str(u) not in cites:
            cites.append(str(u))
    return {"answer": answer, "citations": cites}


def _ensure(db):
    if "geo_queries" not in set(db.table_names()):
        db["geo_queries"].create(
            {
                "id": str, "agent_id": str, "query": str, "surface": str,
                "status": str, "answer": str, "competitors": str,
                "citations": str, "engine": str,
                "last_checked": int, "created_at": int,
            },
            pk="id",
        )
        db["geo_queries"].create_index(["agent_id"])
    else:
        # Migrate older tables: add the captured-answer / citation columns in place.
        cols = set(db["geo_queries"].columns_dict)
        for c in ("answer", "competitors", "citations", "engine"):
            if c not in cols:
                db["geo_queries"].add_column(c, str)
    if "geo_checks" not in set(db.table_names()):
        db["geo_checks"].create(
            {
                "id": str, "query_id": str, "agent_id": str, "status": str,
                "answer": str, "competitors": str, "citations": str, "engine": str,
                "checked_at": int,
            },
            pk="id",
        )
        db["geo_checks"].create_index(["query_id"])
    else:
        cols = set(db["geo_checks"].columns_dict)
        for c in ("citations", "engine"):
            if c not in cols:
                db["geo_checks"].add_column(c, str)
    return db


def list_queries(agent_id: str | None = None) -> dict:
    db = _ensure(init_reply_schema())
    aid = agent_id or active_id() or "default"
    rows = [dict(r) for r in db["geo_queries"].rows_where("agent_id = ?", [aid], order_by="created_at desc")]
    cited = sum(1 for r in rows if r.get("status") == "cited")
    rate = round(100 * cited / len(rows)) if rows else 0
    # Share of Voice — your cited count vs. the total named players (you + rivals)
    # aggregated across all tracked queries' captured competitors.
    rival_hits = 0
    rivals: dict = {}
    for r in rows:
        try:
            for c in json.loads(r.get("competitors") or "[]"):
                k = str(c).strip()
                if k:
                    rivals[k] = rivals.get(k, 0) + 1
                    rival_hits += 1
        except Exception:
            pass
    sov = round(100 * cited / (cited + rival_hits)) if (cited + rival_hits) else 0
    top_rivals = sorted(rivals.items(), key=lambda kv: kv[1], reverse=True)[:6]
    return {
        "queries": rows, "total": len(rows), "cited": cited, "citation_rate": rate,
        "share_of_voice": sov,
        "top_competitors": [{"name": k, "count": v} for k, v in top_rivals],
        "trend": _citation_trend(db, aid),
    }


def _citation_trend(db, aid: str, days: int = 30) -> dict:
    """Daily citation rate (cited / total checks per UTC day) over the window,
    aggregated across all of the agent's tracked queries — for the GEO chart."""
    from datetime import datetime, timezone
    cutoff = int(time.time()) - days * 86400
    buckets: dict[str, list[int]] = {}  # "YYYY-MM-DD" → [cited, total]
    try:
        rows = db["geo_checks"].rows_where(
            "agent_id = ? AND checked_at >= ?", [aid, cutoff], order_by="checked_at asc")
    except Exception:
        rows = []
    for r in rows:
        d = dict(r)
        ts = int(d.get("checked_at") or 0)
        if ts <= 0:
            continue
        day = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
        b = buckets.setdefault(day, [0, 0])
        b[1] += 1
        if d.get("status") == "cited":
            b[0] += 1
    labels = sorted(buckets)
    return {
        "labels": labels,
        "rates": [round(100 * buckets[k][0] / buckets[k][1]) if buckets[k][1] else 0 for k in labels],
        "totals": [buckets[k][1] for k in labels],
    }


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


def _check_llm(query: str, surface: str, brand: str, provider: str | None) -> dict:
    """Fallback check: ask the BYOK model directly (no live web)."""
    sys = (
        f"You are {surface}, answering a user's question the way that assistant would. "
        "Recommend SPECIFIC named tools, brands, products, or sources — be honest and "
        "concrete, do not hedge. Output ONLY JSON: "
        '{"answer": "<2-4 sentence answer naming specific options>", '
        '"recommendations": ["<brand/tool/source>", ...]}'
    )
    try:
        raw = get_provider(provider).complete(f'User question: "{query}"', system=sys, max_tokens=600, temperature=0.4)
    except Exception as e:
        return {"error": f"check failed (LLM not configured?): {e}"}
    data = _parse_json(raw)
    answer = (data.get("answer") or raw or "").strip()
    recs = data.get("recommendations") or []
    if not isinstance(recs, list):
        recs = [str(recs)]
    status, competitors = _classify(brand, answer, recs)
    return {"status": status, "answer": answer, "competitors": competitors,
            "citations": [], "engine": "llm"}


def _check_perplexity(query: str, brand: str, website: str, key: str) -> dict:
    """Real check: ask Perplexity Sonar and detect citation by DOMAIN + brand name."""
    res = _perplexity_sonar(query, key)
    if res.get("error"):
        return res
    answer, cites = res.get("answer", ""), res.get("citations", [])
    my = _domain(website)
    cited_domains = [_domain(u) for u in cites if _domain(u)]
    brand_in_answer = bool(brand) and brand.lower() in answer.lower()
    cited = (bool(my) and any(d == my or d.endswith("." + my) or my.endswith("." + d) for d in cited_domains)) or brand_in_answer
    # competitors = the other cited domains (deduped, order-preserved), minus ours
    seen, competitors = set(), []
    for d in cited_domains:
        if d and d != my and d not in seen:
            seen.add(d)
            competitors.append(d)
    status = "cited" if cited else ("competitor" if competitors else "absent")
    return {"status": status, "answer": answer, "competitors": competitors[:8],
            "citations": cites[:12], "engine": "perplexity"}


def check_query(qid: str, provider: str | None = None) -> dict:
    """Automated visibility check. Uses Perplexity Sonar (real citations) when a
    key is configured, else falls back to the BYOK model's own answer."""
    db = _ensure(init_reply_schema())
    rows = list(db["geo_queries"].rows_where("id = ?", [qid], limit=1))
    if not rows:
        return {"error": f"no tracked query '{qid}'"}
    q = rows[0]
    agent = get_agent(q.get("agent_id")) or {}
    brand = agent.get("brand") or agent.get("name") or ""
    website = agent.get("website") or ""
    surface = q.get("surface") or "ChatGPT"

    key = _pplx_key()
    res = _check_perplexity(q["query"], brand, website, key) if key else None
    if res is None or res.get("error"):
        # No key, or Perplexity failed → fall back to the direct-LLM check.
        res = _check_llm(q["query"], surface, brand, provider)
    if res.get("error"):
        return res

    now = int(time.time())
    comp_json = json.dumps(res["competitors"], ensure_ascii=False)
    cite_json = json.dumps(res.get("citations") or [], ensure_ascii=False)
    patch = {
        "status": res["status"], "answer": res["answer"], "competitors": comp_json,
        "citations": cite_json, "engine": res.get("engine", "llm"), "last_checked": now,
    }
    db["geo_queries"].update(qid, patch)
    db["geo_checks"].insert({
        "id": hashlib.sha1(f"{qid}|{now}".encode()).hexdigest()[:14],
        "query_id": qid, "agent_id": q.get("agent_id") or "", "status": res["status"],
        "answer": res["answer"], "competitors": comp_json, "citations": cite_json,
        "engine": res.get("engine", "llm"), "checked_at": now,
    }, pk="id")
    return {**q, **patch, "competitors": res["competitors"],
            "citations": res.get("citations") or [], "brand": brand}


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


def due_for_scheduled_check(agent_id: str | None = None, min_hours: float = 20.0) -> bool:
    """True when the agent's GEO queries haven't been auto-checked within
    `min_hours`. Throttles the launchd tick so it doesn't re-run BYOK/Perplexity
    checks (which cost tokens) every cycle — once a day is plenty for a trend."""
    db = _ensure(init_reply_schema())
    aid = agent_id or active_id() or "default"
    if not list(db["geo_queries"].rows_where("agent_id = ?", [aid], limit=1)):
        return False  # nothing tracked
    rows = list(db["geo_checks"].rows_where(
        "agent_id = ?", [aid], order_by="checked_at desc", limit=1))
    if not rows:
        return True
    last = int(dict(rows[0]).get("checked_at") or 0)
    return (int(time.time()) - last) >= int(min_hours * 3600)


def check_all_if_due(agent_id: str | None = None, provider: str | None = None,
                     min_hours: float = 20.0) -> dict:
    """Run `check_all` only when due (throttled) — called by the scheduler so
    citation trends fill automatically without burning tokens every tick."""
    if not due_for_scheduled_check(agent_id, min_hours):
        return {"skipped": True, "reason": "checked recently or no tracked queries"}
    return check_all(agent_id=agent_id, provider=provider)


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
