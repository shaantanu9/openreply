"""Find + score engagement opportunities across the picked platforms.

Discovery reuses the existing fetch layer:
  - Reddit: live `fetch_reddit_free()` (cookie/RSS, no API key).
  - Every other platform: best-effort run its `collect_adapter.SOURCES[key]`
    adapter to populate the shared `posts` table, then read candidates back.
    This means non-Reddit platforms surface whatever has been collected (run
    `openreply research collect` or connect via Reach Connections to enrich them).

Scoring asks the BYOK LLM for relevance / intent / fit (0-1), with a keyword
heuristic fallback when no provider is configured. Results persist to
`reply_opportunities` and are returned ranked.
"""
from __future__ import annotations

import hashlib
import queue as _queue
import threading as _threading
import time

from ..analyze.providers.base import get_provider
from . import rank as _rank
from .brand import get_brand
from .schema import init_reply_schema
from .platforms import all_keys, can_reply
from .util import loads_json

_SCORE_SYS = "You score social posts as outreach opportunities for a brand. Output ONLY JSON."
_INTENT_WORDS = (
    "recommend", "alternative", "how do i", "how to", "best tool", "best app",
    "help", "stuck", "looking for", "suggestion", "any tips", "vs ", "which ",
)

# Hard wall-clock budgets (s) so one slow/credential-less adapter (X's bird/cookie
# chain, YouTube via yt-dlp) or LLM rate-limit backoff can't hang the whole scan.
# These are TOTAL budgets across all platforms / all scoring — not per-item — so
# adding more sources never multiplies the wait. Whatever finishes in time is kept.
GATHER_BUDGET = 35.0   # total time to collect candidates across every platform
SCORE_BUDGET = 40.0    # total time to LLM-score the capped candidate set
SCORE_CAP = 30         # max posts LLM-scored (top-ranked by a cheap pre-rank)


def _bounded(thunks: list, budget: float, workers: int) -> list:
    """Run each 0-arg `thunk` in a DAEMON thread (bounded concurrency) and return
    the results that finish within `budget` seconds total. Daemon threads are the
    crux: a slow adapter (yt-dlp / X-bird, minutes long) is simply abandoned — it
    can't block the process at exit the way ThreadPoolExecutor's non-daemon worker
    threads do (that join-at-exit was turning a fast result into a 4-minute hang)."""
    if not thunks:
        return []
    out: list = []
    q: _queue.Queue = _queue.Queue()
    sem = _threading.Semaphore(max(1, workers))

    def _run(th):
        with sem:
            try:
                q.put((True, th()))
            except Exception:
                q.put((False, None))

    for th in thunks:
        _threading.Thread(target=_run, args=(th,), daemon=True).start()
    deadline = time.time() + budget
    for _ in range(len(thunks)):
        remaining = deadline - time.time()
        if remaining <= 0:
            break
        try:
            ok, val = q.get(timeout=remaining)
        except _queue.Empty:
            break
        if ok:
            out.append(val)
    return out


def _oid(brand_id: str, platform: str, post_id: str) -> str:
    return hashlib.sha1(f"{brand_id}|{platform}|{post_id}".encode()).hexdigest()[:16]


def _as_epoch(v) -> int | None:
    """Normalize a source post's created_utc to int epoch SECONDS, or None.

    Sources vary: reddit gives float epoch seconds, some give milliseconds, a few
    give ISO-8601 strings. Be tolerant so the UI always gets a usable timestamp."""
    if v is None or v == "":
        return None
    try:
        f = float(v)
        if f > 1e12:  # milliseconds → seconds
            f /= 1000.0
        return int(f) if f > 0 else None
    except (TypeError, ValueError):
        pass
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp())
    except Exception:
        return None


# ---- candidate discovery -------------------------------------------------

def _tracked_subs() -> list[str]:
    """The agent's tracked subreddits (the communities it monitors) — drives the
    list-aware Reddit pass below so discovery isn't keyword-search-only."""
    try:
        from .subreddit import list_tracked
        return [s.get("sub") for s in (list_tracked().get("subreddits") or [])
                if s.get("tracked") and s.get("sub")]
    except Exception:
        return []


def _fetch_reddit(keywords: list[str], limit: int) -> list[dict]:
    """Reddit candidate discovery. Each keyword×sort (and tracked-sub) fetch is a
    slow network round-trip, so we run them CONCURRENTLY and time-box the batch —
    the sequential version cost ~60s for 8 queries and made `find` feel hung."""
    from ..sources.reddit_free import fetch_reddit_free

    # 1) Keyword search across all of Reddit (recency + relevance), plus 2) the
    # agent's TRACKED subreddits. Cap keywords to keep the fan-out bounded.
    tasks: list[tuple[str, str | None, str]] = []
    for sort in ("new", "relevance"):
        for kw in keywords[:5]:
            tasks.append((kw, None, sort))
    subs = _tracked_subs()
    if subs:
        q = " OR ".join(keywords[:6]) or (keywords[0] if keywords else "")
        for sub in subs[:10]:
            tasks.append((q, sub, "new"))
    if not tasks:
        return []

    def _one(t: tuple[str, str | None, str]) -> list[dict]:
        kw, sub, sort = t
        try:
            return (fetch_reddit_free(kw, sub=sub, limit=limit, sort=sort) if sub
                    else fetch_reddit_free(kw, limit=limit, sort=sort)) or []
        except Exception:
            return []

    rows: list[dict] = []
    seen: set[str] = set()
    for items in _bounded([(lambda t=t: _one(t)) for t in tasks], budget=25.0, workers=8):
        for r in items or []:
            rid = str(r.get("id") or r.get("url") or "")
            if rid and rid in seen:
                continue
            if rid:
                seen.add(rid)
            rows.append(r)
    return rows


def _try_adapter(platform: str, keywords: list[str], limit: int) -> None:
    """Best-effort: run the platform's source adapter to populate `posts`."""
    try:
        from ..sources.collect_adapter import SOURCES

        fn = SOURCES.get(platform)
        if fn:
            fn(keywords, limit)
    except Exception:
        pass


def _posts_from_db(platform: str, keywords: list[str], limit: int) -> list[dict]:
    db = init_reply_schema()
    cols = ["id", "sub", "source_type", "author", "title", "selftext", "url", "score", "created_utc"]
    kw_clause = " OR ".join(["(lower(title) LIKE ? OR lower(selftext) LIKE ?)"] * len(keywords)) or "1=1"
    args: list = [f"{platform}%"]
    for kw in keywords:
        k = f"%{kw.lower()}%"
        args += [k, k]
    args.append(limit)
    sql = (
        f"SELECT {', '.join(cols)} FROM posts "
        f"WHERE source_type LIKE ? AND ({kw_clause}) "
        f"ORDER BY created_utc DESC LIMIT ?"
    )
    try:
        rows = db.execute(sql, args).fetchall()
    except Exception:
        return []
    return [dict(zip(cols, r)) for r in rows]


def _candidates(platform: str, keywords: list[str], limit: int) -> list[dict]:
    if platform in ("reddit", "reddit_free"):
        return _fetch_reddit(keywords, limit)
    _try_adapter(platform, keywords, limit)
    return _posts_from_db(platform, keywords, limit)


# ---- scoring -------------------------------------------------------------

def _heuristic(brand: dict, title: str, body: str) -> dict:
    text = f"{title} {body}".lower()
    kws = [k.lower() for k in brand.get("keywords", []) if k]
    hits = sum(1 for k in kws if k in text)
    rel = min(1.0, hits / len(kws)) if kws else 0.0
    intent = 0.6 if any(w in text for w in _INTENT_WORDS) else 0.2
    return {"relevance": rel, "intent": intent, "fit": 0.5, "reason": "heuristic (no LLM)"}


def _score(brand: dict, post: dict, provider: str | None = None) -> dict:
    title = post.get("title") or ""
    body = (post.get("selftext") or post.get("body") or "")[:1200]
    prompt = (
        f"Brand: {brand.get('name')} — {brand.get('description')}\n"
        f"Keywords: {', '.join(brand.get('keywords', []))}\n\n"
        f"POST\ntitle: {title}\nbody: {body}\n\n"
        "Rate this post as an opportunity for the brand to leave a genuinely helpful reply.\n"
        'Return JSON: {"relevance":0-1,"intent":0-1,"fit":0-1,"reason":"one sentence"}\n'
        "- relevance: topical match to the brand's space\n"
        "- intent: is the author seeking help / a solution / a recommendation (buying intent)?\n"
        "- fit: can the brand add real value without being spammy?"
    )
    try:
        raw = get_provider(provider).complete(prompt, system=_SCORE_SYS, max_tokens=200, temperature=0.0)
        data = loads_json(raw)
        rel = float(data.get("relevance", 0) or 0)
        intent = float(data.get("intent", 0) or 0)
        fit = float(data.get("fit", 0) or 0)
        reason = str(data.get("reason", ""))[:300]
        if not data:
            raise ValueError("empty")
    except Exception:
        h = _heuristic(brand, title, body)
        rel, intent, fit, reason = h["relevance"], h["intent"], h["fit"], h["reason"]
    overall = round(0.4 * rel + 0.4 * intent + 0.2 * fit, 3)
    return {"relevance": rel, "intent": intent, "fit": fit, "reason": reason, "score": overall}


# ---- public API ----------------------------------------------------------
# ---- multi-source scan scope ---------------------------------------------

def _connected_engage() -> list[str]:
    """Reply-capable sources the user connected via Reach Connections, so
    connecting X / Instagram / LinkedIn / etc. makes the agent scan them too."""
    try:
        from ..research.reach_connections import connected_collection_sources
        return [s for s in connected_collection_sources() if can_reply(s)]
    except Exception:
        return []


def _corpus_engage() -> list[str]:
    """Reply-capable sources that already have posts in the corpus — so discovery
    scans everything we've collected, not just the explicitly picked platforms."""
    db = init_reply_schema()
    out: list[str] = []
    for k in (p for p in all_keys() if can_reply(p)):
        try:
            if db.execute("SELECT 1 FROM posts WHERE source_type LIKE ? LIMIT 1",
                          [f"{k}%"]).fetchone():
                out.append(k)
        except Exception:
            pass
    return out


def _scan_platforms(picked: list[str] | None) -> list[str]:
    """The set of platforms to actually scan: what the user picked, PLUS any
    reply-capable sources they've connected, PLUS any already in the corpus.
    Reddit is always included as the baseline. Deduped, order-preserving — so an
    agent replies across all available social media, not only its picked list."""
    out: list[str] = []
    for p in (list(picked or []) + ["reddit_free"] + _connected_engage() + _corpus_engage()):
        if p and p not in out:
            out.append(p)
    return out


# ---- public API ----------------------------------------------------------

def find_opportunities(
    *,
    platforms: list[str] | None = None,
    limit_per_platform: int = 15,
    score: bool = True,
    provider: str | None = None,
    progress=None,
) -> dict:
    brand = get_brand()
    if not brand:
        return {"error": "no brand configured. Run: openreply reply brand-set --name ... --keywords ..."}

    # Discover by what the agent's AUDIENCE searches for — topics/keywords the
    # LLM derives from the agent's identity — NOT the literal agent name (an
    # agent named "textnote" must not just search the string "textnote").
    from .keywords import agent_search_keywords
    keywords = agent_search_keywords(brand, provider=provider)
    if not keywords:
        return {"error": "agent has no topic to search. Set a niche, product, goal, or keywords."}
    platforms = _scan_platforms(platforms or brand.get("platforms"))

    db = init_reply_schema()
    now = int(time.time())
    # Feedback: never resurface a post the user already dismissed.
    try:
        from .feedback import dismissed_post_ids
        _dismissed = dismissed_post_ids(brand["id"])
    except Exception:
        _dismissed = set()
    # 1) Gather candidates from every platform IN PARALLEL, each time-boxed. A
    #    credential-less adapter (e.g. X's cookie/bird/xAI chain ~85s) or a slow
    #    Reddit sweep can no longer stall the whole scan — we stop waiting at
    #    PLATFORM_TIMEOUT. (Timed-out worker threads die with this one-shot CLI.)
    if progress:
        progress(f"scanning {len(platforms)} platforms…")
    seen_pids: set[str] = set()
    cand_pairs: list[tuple[str, dict]] = []
    # ONE overall deadline for the whole fan-out (daemon threads) — a slow platform
    # that doesn't finish is abandoned and can't block the process at exit.
    def _gather(pf):
        try:
            return (pf, _candidates(pf, keywords, limit_per_platform) or [])
        except Exception:
            return (pf, [])
    for pf, cands in _bounded([(lambda pf=pf: _gather(pf)) for pf in platforms],
                              budget=GATHER_BUDGET, workers=min(8, max(1, len(platforms)))):
        for post in cands:
            pid = str(post.get("id") or post.get("url") or "")
            if not pid or pid in _dismissed or pid in seen_pids:
                continue
            seen_pids.add(pid)
            cand_pairs.append((pf, post))

    # 2) Cap to the strongest candidates by a cheap pre-rank (engagement+freshness),
    #    then LLM-score them IN PARALLEL — the sequential per-post scoring was the
    #    other half of the hang (N blocking round-trips).
    cand_pairs.sort(key=lambda pp: _rank.engagement_score(pp[1]) + _rank.freshness(pp[1], now), reverse=True)
    cand_pairs = cand_pairs[:SCORE_CAP]
    if progress:
        progress(f"scoring {len(cand_pairs)} posts…")

    def _build(pf: str, post: dict) -> dict:
        pid = str(post.get("id") or post.get("url") or "")
        sc = _score(brand, post, provider) if score else {
            "score": 0.0, "relevance": 0.0, "intent": 0.0, "fit": 0.0, "reason": ""
        }
        return {
            "id": _oid(brand["id"], pf, pid),
            "brand_id": brand["id"], "platform": pf, "post_id": pid,
            "title": (post.get("title") or "")[:300],
            "body": (post.get("selftext") or post.get("body") or "")[:2000],
            "url": post.get("url") or post.get("permalink") or "",
            "author": post.get("author") or "", "sub": post.get("sub") or "",
            "relevance": sc["relevance"], "intent": sc["intent"], "fit": sc["fit"],
            "reason": sc["reason"], "status": "new", "found_at": now,
            "created_utc": _as_epoch(post.get("created_utc")),
            "base": sc["score"],
            "eng": _rank.engagement_score(post),
            "fresh": _rank.freshness(post, now),
        }

    found: list[dict] = _bounded(
        [(lambda pf=pf, post=post: _build(pf, post)) for pf, post in cand_pairs],
        budget=SCORE_BUDGET, workers=6)

    # Engagement-weighted RRF fusion across the picked platforms.
    _rank.fuse_and_rank(found)
    for rec in found:
        rec["engagement"] = rec.pop("eng")
        rec["freshness"] = rec.pop("fresh")
        rec["score"] = rec.pop("final")  # `score` = fused final (kept for back-compat/sort)
        rec.pop("base", None)
        db["reply_opportunities"].upsert(rec, pk="id")

    return {
        "brand": brand["name"], "platforms": platforms,
        "found": len(found), "opportunities": found[:50],
    }


# How often each cadence re-scans (hours). `off`/`manual` never auto-scan.
_CADENCE_HOURS = {"daily": 20.0, "weekly": 24.0 * 6.5}


def find_if_due(provider: str | None = None) -> dict:
    """Auto-find new opportunities on the active agent's refresh cadence — the
    core of the scheduled auto-flow. Opt-in + throttled:
      - `refresh_cadence` of `off`/`manual` → skipped (the default; no surprise
        token spend);
      - `daily` re-scans at most ~once/20h, `weekly` ~once/6.5d, gated by
        `last_refresh_at`.
    On a run it calls `find_opportunities` and stamps `last_refresh_at`."""
    from .agent import get_active_agent, update_agent
    a = get_active_agent()
    if not a:
        return {"skipped": True, "reason": "no active agent"}
    cadence = (a.get("refresh_cadence") or "off").lower()
    if cadence not in _CADENCE_HOURS:
        return {"skipped": True, "reason": f"cadence '{cadence}' (set Daily/Weekly to auto-scan)"}
    now = int(time.time())
    last = int(a.get("last_refresh_at") or 0)
    if last and (now - last) < int(_CADENCE_HOURS[cadence] * 3600):
        return {"skipped": True, "reason": "scanned recently", "cadence": cadence}
    res = find_opportunities(provider=provider)
    try:
        update_agent(a["id"], last_refresh_at=now)
    except Exception:
        pass
    _notify_new_opportunities(res.get("opportunities") or [])
    return {"skipped": False, "cadence": cadence, "found": res.get("found", 0),
            "error": res.get("error")}


def _notify_new_opportunities(opps: list[dict], cap: int = 5) -> None:
    """Push Telegram/Slack alerts for the strongest, not-yet-notified finds.
    Best-effort, threshold-gated, deduped per opportunity id."""
    try:
        from . import notify as _n
    except Exception:
        return
    if not _n.is_configured():
        return
    cfg = _n.get_config()
    if not cfg["events"].get("opportunity"):
        return
    floor = float(cfg.get("min_score") or 0.0)
    ranked = sorted(opps, key=lambda o: float(o.get("score") or 0), reverse=True)
    sent = 0
    for opp in ranked:
        if sent >= cap:
            break
        if float(opp.get("score") or 0) < floor:
            break  # ranked desc — nothing below will qualify either
        _n.notify_once(f"opp:{opp.get('id')}", "opportunity", {"opp": opp})
        sent += 1


# Lifecycle states an opportunity can move through.
#   new      → freshly found (discovery feed)
#   saved    → user bookmarked it (enters the Inbox workspace)
#   drafted  → a reply draft exists (generate/save_draft)
#   ready    → draft approved, awaiting post/queue
#   queued   → scheduled for posting (has scheduled_at)
#   posted   → replied/posted (manual mark or auto)
#   skipped  → dismissed (hidden from default views)
#   snoozed  → deferred until snooze_until, then auto-resurfaced to `new`
OPPORTUNITY_STATUSES = (
    "new", "saved", "drafted", "ready", "queued", "posted", "skipped", "snoozed",
)
# Statuses that constitute the Inbox workspace (vs the discovery feed).
INBOX_STATUSES = ("saved", "drafted", "ready", "queued", "posted")


def _resurface_snoozed(db, brand_id: str, now: int) -> None:
    """Flip snoozed opportunities whose snooze window has elapsed back to `new`
    so they reappear in discovery. Best-effort; never raises."""
    try:
        db.execute(
            "UPDATE reply_opportunities SET status='new', snooze_until=NULL, "
            "updated_at=? WHERE brand_id=? AND status='snoozed' "
            "AND snooze_until IS NOT NULL AND snooze_until <= ?",
            [now, brand_id, now],
        )
        db.conn.commit()
    except Exception:
        pass


def set_status(opportunity_id: str, status: str, operator: str | None = None) -> dict:
    """Move an opportunity to a new lifecycle status. Returns the updated row,
    or an {"error": …} dict on a bad id / status. Never raises.
    `operator` is an optional attribution string (e.g. Telegram @username) for
    company-mode audit trails."""
    status = (status or "").strip().lower()
    if status not in OPPORTUNITY_STATUSES:
        return {"error": f"invalid status '{status}'. "
                f"Use one of: {', '.join(OPPORTUNITY_STATUSES)}"}
    db = init_reply_schema()
    now = int(time.time())
    fields: dict = {"status": status, "updated_at": now}
    if status == "posted":
        fields["posted_at"] = now
    if operator:
        fields["operator"] = operator
        fields["operator_actioned_at"] = now
    try:
        db["reply_opportunities"].update(opportunity_id, fields)
    except Exception as e:
        return {"error": f"no opportunity '{opportunity_id}': {e}"}
    # Feed the lifecycle signal back into learning: saved/replied → engaged
    # (seed the corpus), skipped → dismissed (suppress from future finds).
    _sig = {"saved": "engaged", "posted": "engaged", "skipped": "dismissed"}.get(status)
    if _sig:
        try:
            from .feedback import record_opportunity_feedback
            record_opportunity_feedback(opportunity_id, _sig)
        except Exception:
            pass
    try:
        row = dict(db["reply_opportunities"].get(opportunity_id))
    except Exception:
        row = {"id": opportunity_id, "status": status}
    return {"ok": True, "id": opportunity_id, "status": status,
            "operator": operator, "opportunity": row}


def snooze(opportunity_id: str, hours: float = 24.0,
           operator: str | None = None) -> dict:
    """Defer an opportunity for `hours`. It auto-resurfaces to `new` once the
    window elapses (see `_resurface_snoozed`)."""
    db = init_reply_schema()
    now = int(time.time())
    until = now + int(max(0.0, hours) * 3600)
    fields = {"status": "snoozed", "snooze_until": until, "updated_at": now}
    if operator:
        fields["operator"] = operator
        fields["operator_actioned_at"] = now
    try:
        db["reply_opportunities"].update(opportunity_id, fields)
    except Exception as e:
        return {"error": f"no opportunity '{opportunity_id}': {e}"}
    return {"ok": True, "id": opportunity_id, "status": "snoozed",
            "snooze_until": until, "operator": operator}


def approve(opportunity_id: str, operator: str | None = None) -> dict:
    """Approve the current draft — moves the opportunity to `ready` (awaiting
    post or queue)."""
    return set_status(opportunity_id, "ready", operator=operator)


def queue(opportunity_id: str, scheduled_at: int | None = None,
          operator: str | None = None) -> dict:
    """Queue the approved reply for posting. `scheduled_at` is an epoch second;
    when omitted the reply is queued for immediate/next-cycle posting."""
    db = init_reply_schema()
    now = int(time.time())
    sched = int(scheduled_at) if scheduled_at else now
    fields = {"status": "queued", "scheduled_at": sched, "updated_at": now}
    if operator:
        fields["operator"] = operator
        fields["operator_actioned_at"] = now
    try:
        db["reply_opportunities"].update(opportunity_id, fields)
    except Exception as e:
        return {"error": f"no opportunity '{opportunity_id}': {e}"}
    return {"ok": True, "id": opportunity_id, "status": "queued",
            "scheduled_at": sched, "operator": operator}


def mark_posted(opportunity_id: str, operator: str | None = None) -> dict:
    """Mark a reply as posted (manual-assisted flow)."""
    return set_status(opportunity_id, "posted", operator=operator)


def _search_clause(query: str | None, args: list) -> str:
    """Append a case-insensitive text filter over title/body/author/sub."""
    q = (query or "").strip().lower()
    if not q:
        return ""
    like = f"%{q}%"
    args += [like, like, like, like]
    return (" AND (lower(title) LIKE ? OR lower(body) LIKE ? "
            "OR lower(author) LIKE ? OR lower(sub) LIKE ?)")


_SORTS = {
    "score": "score desc",
    # "Most recent" = newest by the SOURCE POST's own publish time (created_utc),
    # so the freshest still-replyable threads surface first. Falls back to when we
    # found it for any row missing a publish timestamp.
    "recent": "coalesce(created_utc, found_at) desc",
    "engagement": "coalesce(engagement, 0) desc",
}


def _list_where(status: str | None, min_score: float, query: str | None, platform: str | None = None):
    from .agent import active_id

    where = "brand_id = ? AND score >= ?"
    args: list = [active_id() or "default", min_score]
    if status:
        where += " AND status = ?"
        args.append(status)
    else:
        # default view hides snoozed (deferred) opportunities
        where += " AND status != 'snoozed'"
    if platform:
        where += " AND platform = ?"
        args.append(platform)
    where += _search_clause(query, args)
    return where, args


def list_opportunities(
    status: str | None = None,
    limit: int = 50,
    min_score: float = 0.0,
    query: str | None = None,
    sort: str = "score",
    offset: int = 0,
    platform: str | None = None,
) -> list[dict]:
    db = init_reply_schema()
    _resurface_snoozed(db, _active_brand_id(), int(time.time()))
    where, args = _list_where(status, min_score, query, platform)
    order_by = _SORTS.get((sort or "score").lower(), _SORTS["score"])
    return [dict(r) for r in db["reply_opportunities"].rows_where(
        where, args, order_by=order_by, limit=limit, offset=max(0, offset))]


def count_opportunities(
    status: str | None = None, min_score: float = 0.0, query: str | None = None,
    platform: str | None = None,
) -> int:
    """Total matching rows (ignoring limit/offset) — for pagination. Honors the
    platform filter so a filtered list reports the right total (was ignoring it)."""
    db = init_reply_schema()
    where, args = _list_where(status, min_score, query, platform)
    try:
        return db["reply_opportunities"].count_where(where, args)
    except Exception:
        return 0


def _active_brand_id() -> str:
    from .agent import active_id
    return active_id() or "default"


def source_counts() -> dict:
    """Per-source signal for the active brand: how many opportunities we've found
    and how many posts we've fetched into the corpus, grouped by source. Powers the
    Opportunities source dropdown so the user sees which source has how much. Never
    raises — returns zeros on any failure."""
    db = init_reply_schema()
    bid = _active_brand_id()
    opp: dict[str, int] = {}
    posts: dict[str, int] = {}
    try:
        for row in db.execute(
            "SELECT platform, COUNT(*) FROM reply_opportunities "
            "WHERE brand_id=? AND COALESCE(status,'new') != 'skipped' GROUP BY platform",
            [bid],
        ).fetchall():
            if row[0]:
                opp[str(row[0])] = int(row[1])
    except Exception:
        pass
    try:
        from .agent import get_agent
        topic = (get_agent(bid) or {}).get("topic")
        if topic:
            for row in db.execute(
                "SELECT p.source_type, COUNT(*) FROM topic_posts tp "
                "JOIN posts p ON p.id = tp.post_id WHERE tp.topic=? GROUP BY p.source_type",
                [topic],
            ).fetchall():
                if row[0]:
                    posts[str(row[0])] = int(row[1])
    except Exception:
        pass
    return {
        "opportunities": opp, "posts": posts,
        "total_opportunities": sum(opp.values()), "total_posts": sum(posts.values()),
    }
