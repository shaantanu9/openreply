"""Find + score engagement opportunities across the picked platforms.

Discovery reuses the existing fetch layer:
  - Reddit: live `fetch_reddit_free()` (cookie/RSS, no API key).
  - Every other platform: best-effort run its `collect_adapter.SOURCES[key]`
    adapter to populate the shared `posts` table, then read candidates back.
    This means non-Reddit platforms surface whatever has been collected (run
    `gapmap research collect` or connect via Reach Connections to enrich them).

Scoring asks the BYOK LLM for relevance / intent / fit (0-1), with a keyword
heuristic fallback when no provider is configured. Results persist to
`reply_opportunities` and are returned ranked.
"""
from __future__ import annotations

import hashlib
import time

from ..analyze.providers.base import get_provider
from . import rank as _rank
from .brand import get_brand
from .schema import init_reply_schema
from .util import loads_json

_SCORE_SYS = "You score social posts as outreach opportunities for a brand. Output ONLY JSON."
_INTENT_WORDS = (
    "recommend", "alternative", "how do i", "how to", "best tool", "best app",
    "help", "stuck", "looking for", "suggestion", "any tips", "vs ", "which ",
)


def _oid(brand_id: str, platform: str, post_id: str) -> str:
    return hashlib.sha1(f"{brand_id}|{platform}|{post_id}".encode()).hexdigest()[:16]


# ---- candidate discovery -------------------------------------------------

def _fetch_reddit(keywords: list[str], limit: int) -> list[dict]:
    from ..sources.reddit_free import fetch_reddit_free

    rows: list[dict] = []
    for kw in keywords:
        try:
            rows += fetch_reddit_free(kw, limit=limit)
        except Exception:
            pass
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
        return {"error": "no brand configured. Run: gapmap reply brand-set --name ... --keywords ..."}

    keywords = [k for k in (brand.get("keywords") or [brand.get("name", "")]) if k]
    if not keywords:
        return {"error": "brand has no keywords. Run: gapmap reply brand-set --keywords a,b,c"}
    platforms = platforms or brand.get("platforms") or ["reddit_free"]

    db = init_reply_schema()
    now = int(time.time())
    found: list[dict] = []
    for pf in platforms:
        if progress:
            progress(f"scanning {pf}…")
        try:
            cands = _candidates(pf, keywords, limit_per_platform)
        except Exception:
            cands = []
        for post in cands:
            pid = str(post.get("id") or post.get("url") or "")
            if not pid:
                continue
            sc = _score(brand, post, provider) if score else {
                "score": 0.0, "relevance": 0.0, "intent": 0.0, "fit": 0.0, "reason": ""
            }
            rec = {
                "id": _oid(brand["id"], pf, pid),
                "brand_id": brand["id"], "platform": pf, "post_id": pid,
                "title": (post.get("title") or "")[:300],
                "body": (post.get("selftext") or post.get("body") or "")[:2000],
                "url": post.get("url") or post.get("permalink") or "",
                "author": post.get("author") or "", "sub": post.get("sub") or "",
                "relevance": sc["relevance"], "intent": sc["intent"], "fit": sc["fit"],
                "reason": sc["reason"], "status": "new", "found_at": now,
                # ranking inputs (consumed by rank.fuse_and_rank, then dropped)
                "base": sc["score"],
                "eng": _rank.engagement_score(post),
                "fresh": _rank.freshness(post, now),
            }
            found.append(rec)

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


# Lifecycle states an opportunity can move through. `new` → freshly found;
# `saved` → user bookmarked it (shows in Inbox); `drafted` → a reply was
# generated (set by generate_reply); `posted` → user replied/posted manually;
# `skipped` → user dismissed it (hidden from the default view).
OPPORTUNITY_STATUSES = ("new", "saved", "drafted", "posted", "skipped")


def set_status(opportunity_id: str, status: str) -> dict:
    """Move an opportunity to a new lifecycle status. Returns the updated row,
    or an {"error": …} dict on a bad id / status. Never raises."""
    status = (status or "").strip().lower()
    if status not in OPPORTUNITY_STATUSES:
        return {"error": f"invalid status '{status}'. "
                f"Use one of: {', '.join(OPPORTUNITY_STATUSES)}"}
    db = init_reply_schema()
    try:
        db["reply_opportunities"].update(opportunity_id, {"status": status})
    except Exception as e:
        return {"error": f"no opportunity '{opportunity_id}': {e}"}
    try:
        row = dict(db["reply_opportunities"].get(opportunity_id))
    except Exception:
        row = {"id": opportunity_id, "status": status}
    return {"ok": True, "id": opportunity_id, "status": status,
            "opportunity": row}


def list_opportunities(status: str | None = None, limit: int = 50, min_score: float = 0.0) -> list[dict]:
    db = init_reply_schema()
    from .agent import active_id

    where = "brand_id = ? AND score >= ?"
    args: list = [active_id() or "default", min_score]
    if status:
        where += " AND status = ?"
        args.append(status)
    return [dict(r) for r in db["reply_opportunities"].rows_where(where, args, order_by="score desc", limit=limit)]
