"""Daily Update (digest) — a once-a-day learning surface for the *user*.

Surfaces what's new in the world about the agent's niche + keywords, framed by
the agent's goal: an LLM-synthesized **briefing** on top + a ranked **feed** of
the freshest news/knowledge below. Reuses the existing collect + corpus + rank
stack rather than building a parallel fetcher.

Cached one row per agent per day (`reply_digest`). The first call each day
builds (light news fetch + synthesis, ~10-20s); subsequent calls return the
cached row instantly. `rebuild=True` forces a fresh build. Fail-soft: never
raises; degrades to feed-only when no LLM is configured.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import datetime, timedelta

from ..analyze.providers.base import get_provider
from .agent import get_agent
from .schema import init_reply_schema
from .util import loads_json

# Sources grouped into the four learning buckets the Overview feed renders.
# Reddit stays OUT — it's the reply/Opportunities surface, not "what's new in the
# world." These keys are all valid `research.collect(sources=…)` entries.
# Product signals (reviews, launches, listings) are mixed into news/articles so
# the daily update covers the *product*, not just the niche.
CATEGORY_SOURCES = {
    "news":      ["gnews", "rss_tech_news", "rss_products", "rss_listings",
                   "duckduckgo", "appstore", "playstore", "trustpilot"],
    "articles":  ["devto", "hn", "github", "producthunt"],
    "community": ["lemmy", "mastodon"],
    "research":  ["arxiv", "pubmed", "scholar"],
}
# Flat list for the daily collect sweep.
DIGEST_SOURCES = [s for v in CATEGORY_SOURCES.values() for s in v]
# Free, key-less sources used by the on-demand news search box.
NEWS_SEARCH_SOURCES = ["gnews", "duckduckgo"]

# source_type (corpus `p.source_type`) → feed category. Prefix-tolerant so a tag
# like "github_trending" or "scholar:kw" still resolves.
_CATEGORY_RULES = (
    ("research",  ("arxiv", "pubmed", "scholar", "semantic_scholar", "openalex",
                   "crossref", "dblp", "unpaywall", "bis")),
    ("community", ("lemmy", "mastodon", "reddit", "bluesky", "linkedin",
                   "truthsocial", "x")),
    ("articles",  ("devto", "hn", "hackernews", "github", "producthunt",
                   "stackoverflow")),
    ("news",      ("gnews", "duckduckgo", "exa", "tavily", "web", "wikipedia",
                   "news")),
)


def _category_of(source: str) -> str:
    base = (source or "").lower().split(":")[0].strip()
    if "rss" in base:
        return "news"
    for cat, keys in _CATEGORY_RULES:
        if base in keys or any(base.startswith(k) for k in keys):
            return cat
    return "news"

_SYS = ("You brief a founder on today's most relevant developments for THEIR GOAL. "
        "Be concrete, skimmable, and honest. Output ONLY strict JSON.")


def _today() -> str:
    return time.strftime("%Y-%m-%d", time.localtime())


def _digest_id(agent_id: str, day: str) -> str:
    return hashlib.sha1(f"{agent_id}|{day}".encode()).hexdigest()[:16]


def _previous_day(day: str) -> str:
    return (datetime.strptime(day, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")


def _day_start_utc(day: str) -> int:
    try:
        return int(time.mktime(time.strptime(day, "%Y-%m-%d")))
    except Exception:
        return int(time.time()) - 86400


def _agent_extra_keywords(a: dict) -> list[str]:
    """Terms from the agent's product/brand/persona/keywords to fold into the
    daily source fan-out. Keeps the niche topic as the canonical corpus key, but
    makes the fetch product-and-persona-aware."""
    seen: set = set()
    terms: list[str] = []
    for field in ("product", "brand", "persona"):
        v = (a.get(field) or "").strip()
        if v and v.lower() not in seen:
            seen.add(v.lower())
            terms.append(v)
    for k in (a.get("keywords") or []):
        v = (k or "").strip()
        if v and v.lower() not in seen:
            seen.add(v.lower())
            terms.append(v)
    return terms[:12]


def _digest_sources_for_agent(a: dict) -> list[str]:
    """Daily-update sources: categorized base set + any connected Reach sources
    (minus Reddit, which stays on the Opportunities surface)."""
    out = list(DIGEST_SOURCES)
    _skip = {"reddit", "reddit_free"}
    try:
        from ..research.reach_connections import connected_collection_sources
        for s in connected_collection_sources():
            if s and s not in out and s not in _skip:
                out.append(s)
    except Exception:
        pass
    return out


def current_digest(agent_id: str | None = None, day: str | None = None) -> dict | None:
    """The agent's digest row for `day` (default today), parsed, or None."""
    db = init_reply_schema()
    a = get_agent(agent_id)
    if not a:
        return None
    day = day or _today()
    try:
        r = db["reply_digest"].get(_digest_id(a["id"], day))
    except Exception:
        return None
    if not r:
        return None
    return _row_to_dict(r, cached=True)


def _row_to_dict(r: dict, *, cached: bool) -> dict:
    def _loads(s, default):
        try:
            return json.loads(s or "")
        except Exception:
            return default
    briefing = _loads(r.get("briefing_json"), None)
    return {
        "ok": True, "cached": cached, "day": r.get("day"),
        "briefing": briefing or None,
        "feed": _loads(r.get("feed_json"), []),
        "sources": _loads(r.get("sources_json"), {}),
        "generated_at": r.get("created_at"),
    }


def _to_feed_item(it: dict, final: float) -> dict:
    return {
        "title": (it.get("title") or "").strip()[:240],
        "url": it.get("url") or "",
        "source": it.get("source") or "",
        "sub": it.get("sub") or "",
        "category": _category_of(it.get("source") or ""),
        "score": round(final, 4),
        "created_utc": it.get("created_utc"),
        "snippet": (it.get("snippet") or "").strip()[:240],
    }


# Common stop-words we ignore when matching posts against the agent's identity.
_STOPWORDS = {
    "the", "and", "for", "with", "you", "your", "from", "about", "into",
    "over", "after", "this", "that", "are", "was", "will", "can", "has",
    "have", "had", "not", "but", "they", "them", "their", "than", "then",
    "only", "also", "may", "might", "should", "could", "would", "there",
    "when", "where", "how", "what", "who", "why", "which", "its", "it's",
    "our", "out", "all", "any", "some", "each", "every", "one", "two",
    "new", "old", "more", "most", "many", "much", "such", "like", "just",
    "now", "here", "today", "via", "using", "used", "use", "get", "got",
    "make", "made", "see", "seen", "way", "work", "works", "need", "needs",
    "want", "wants", "help", "helps", "helped", "time", "times", "year",
    "years", "day", "days", "week", "weeks", "month", "months", "good",
    "best", "better", "great", "real", "really", "first", "last", "next",
    "back", "well", "very", "still", "own", "must", "done", "doing", "being",
    "been", "keep", "keeps", "come", "came", "take", "took", "give", "gave",
    "know", "knew", "think", "thought", "say", "said", "tell", "told", "ask",
    "asked", "show", "shown", "find", "found", "let", "puts", "put", "seem",
    "seems", "try", "tries", "tried", "call", "called", "feel", "feels",
    "become", "became", "leave", "left", "mean", "means", "same", "different",
    "another", "while", "during", "before", "above", "below", "between",
    "under", "again", "once", "upon", "off", "too", "so", "because", "since",
    "until", "although", "though", "unless", "whether", "either", "neither",
    "both", "few", "several", "part", "parts", "place", "places", "case",
    "cases", "point", "points", "thing", "things", "look", "looks", "looking",
    "sound", "sounds", "etc",
    # Product/goal action words that are too generic to match on.
    "yes", "no", "maybe", "drive", "drives", "reply", "replies", "post", "posts",
    "posted", "posting", "author", "authors", "engage", "engages", "engaging",
    "signup", "signups", "sign", "signs", "win", "wins", "winning", "link",
    "links", "linking", "auto", "automatic", "salesy", "concise", "helpful",
    "helping", "struggle", "struggles", "struggling", "organize", "organizes",
    "organizing", "student", "students",
}


def _agent_terms(a: dict) -> set[str]:
    """Significant identity terms for the agent: niche, product, brand, persona,
    goal, keywords, etc. Used to enforce that daily-feed items actually relate."""
    parts = [
        a.get("niche"), a.get("topic"), a.get("product"), a.get("brand"),
        a.get("persona"), a.get("goal"), a.get("objective"),
        ", ".join(a.get("keywords") or []),
    ]
    text = " ".join(str(p) for p in parts if p)
    return {
        w for w in re.findall(r"\b[a-z]{3,}\b", text.lower())
        if w not in _STOPWORDS and not w.isdigit()
    }


def _term_score(it: dict, terms: set[str]) -> float:
    """Fraction of agent identity terms found in the item's title/snippet/sub."""
    if not terms:
        return 1.0
    text = " ".join([
        str(it.get("title") or ""), str(it.get("snippet") or ""),
        str(it.get("sub") or ""), str(it.get("source") or ""),
    ]).lower()
    words = set(re.findall(r"\b[a-z]{3,}\b", text))
    hits = words & terms
    return len(hits) / len(terms)


def _fresh_items(agent_id: str, *, days: int = 7, limit: int = 40,
                 per_cat_floor: int = 3, since_utc: int | None = None,
                 exclude_ids: set | None = None,
                 min_items: int = 8, fallback_days: int = 3) -> list[dict]:
    """Top-N freshest, highest-signal corpus items for the agent, ranked by
    freshness x engagement x source weight and tagged with a feed category.
    Reads the shared corpus via `list_corpus` (no parallel fetcher).

    Daily-update mode: when `since_utc` is set, prefer items published at or
    after that time ("since yesterday" / since the last digest). If too few
    fresh items exist, fall back to `fallback_days` but still exclude anything
    already shown in the previous digest (`exclude_ids`)."""
    from .library import list_corpus
    from .rank import engagement_score, freshness, platform_weight

    a = get_agent(agent_id)
    if not a:
        return []
    terms = _agent_terms(a)

    try:
        res = list_corpus(agent_id, limit=240, offset=0)
    except Exception:
        return []
    items = (res or {}).get("items") or []
    now = time.time()
    cutoff = now - days * 86400
    since = since_utc or cutoff
    exclude_ids = exclude_ids or set()

    def _score(it: dict) -> tuple[float, dict]:
        post = {"score": it.get("score"), "num_comments": it.get("comments"),
                "created_utc": it.get("created_utc")}
        fr = freshness(post, now)
        eng = engagement_score(post)
        src = it.get("source") or ""
        w = platform_weight(src.split("_")[0] if src.startswith("rss") else src)
        ts = _term_score(it, terms)
        # Relevance to the agent's identity is weighted heavily so the feed
        # doesn't fill up with high-engagement but off-topic noise.
        final = 0.35 * fr + 0.20 * eng + 0.15 * w + 0.30 * ts
        return final, it

    def _eligible(it: dict, min_cu: float, allow_undated: bool) -> bool:
        rel = it.get("relevant")
        if rel == 0:
            return False
        # Every feed item must share at least one identity term with the agent,
        # unless the LLM already marked it strongly on-topic.
        if terms and _term_score(it, terms) <= 0:
            if rel != 1 or (it.get("rel_score") or 0) < 0.85:
                return False
        iid = it.get("id") or it.get("url")
        if iid and iid in exclude_ids:
            return False
        cu = it.get("created_utc")
        if cu is None or cu == 0:
            return allow_undated
        return cu >= min_cu

    def _item_id(it: dict) -> str:
        return it.get("id") or it.get("url") or ""

    def _select(pool: list[tuple[float, dict]], exclude: set) -> list[tuple[float, dict]]:
        chosen: list[tuple[float, dict]] = []
        seen: set = set(exclude)
        by_cat: dict[str, list[tuple[float, dict]]] = {}
        for final, it in pool:
            by_cat.setdefault(_category_of(it.get("source") or ""), []).append((final, it))
        for lst in by_cat.values():
            for final, it in lst[:per_cat_floor]:
                iid = _item_id(it)
                if iid in seen:
                    continue
                seen.add(iid)
                chosen.append((final, it))
        for final, it in pool:
            if len(chosen) >= limit:
                break
            iid = _item_id(it)
            if iid in seen:
                continue
            seen.add(iid)
            chosen.append((final, it))
        chosen.sort(key=lambda t: t[0], reverse=True)
        return chosen

    # 1. Strict fresh window ("since yesterday" / since last digest).
    scored = [_score(it) for it in items if _eligible(it, since, allow_undated=False)]
    scored.sort(key=lambda t: t[0], reverse=True)
    chosen = _select(scored, set())

    # 2. Fallback to a wider recent window if the daily delta is thin.
    chosen_ids = {_item_id(c[1]) for c in chosen}
    if len(chosen) < min_items:
        fallback_since = now - fallback_days * 86400
        fallback = [_score(it) for it in items
                    if _eligible(it, fallback_since, allow_undated=False)
                    and _item_id(it) not in chosen_ids]
        fallback.sort(key=lambda t: t[0], reverse=True)
        chosen = _select(scored + fallback, set())
        chosen_ids = {_item_id(c[1]) for c in chosen}

    # 3. Last resort: include undated items so the feed is never empty.
    if len(chosen) < min_items:
        undated = [_score(it) for it in items
                   if _eligible(it, 0, allow_undated=True)
                   and _item_id(it) not in chosen_ids]
        undated.sort(key=lambda t: t[0], reverse=True)
        chosen = _select(scored + fallback + undated, set())

    return [_to_feed_item(it, final) for final, it in chosen[:limit]]


def _goal_block(a: dict) -> str:
    goal = (a.get("goal") or a.get("objective") or "").strip()
    kws = ", ".join((a.get("keywords") or [])[:12])
    return (
        f"GOAL: {goal or '(grow the product helpfully)'}\n"
        f"Niche: {a.get('niche') or a.get('topic') or '-'}\n"
        f"Product: {a.get('product') or a.get('brand') or '-'}\n"
        f"Persona / voice: {a.get('persona') or a.get('tone') or '-'}\n"
        f"Topics to grow in (keywords): {kws or '-'}"
    )


def _synthesize(a: dict, feed: list[dict], provider: str | None) -> dict | None:
    """One LLM call → a goal-framed briefing. Returns None on no-LLM / failure."""
    if not feed:
        return None
    lines = []
    for i, it in enumerate(feed[:12], 1):
        src = it.get("source") or ""
        lines.append(f"[{i}] ({src}) {it.get('title', '')} — {it.get('snippet', '')[:160]}")
    items_txt = "\n".join(lines)
    prompt = (
        f"{_goal_block(a)}\n\n"
        f"Today's freshest items about these topics (from many sources):\n{items_txt}\n\n"
        "Write a short daily briefing for the founder. Group the items into 2-4 "
        "themes. For each theme: a headline, one sentence on WHY IT MATTERS FOR "
        "THE GOAL, and the item numbers it draws on. Add a one-line summary. "
        "Return ONLY this JSON:\n"
        '{"summary":"one line",'
        '"sections":[{"headline":"","why":"","items":[1,2]}]}'
    )
    try:
        data = loads_json(get_provider(provider).complete(
            prompt, system=_SYS, max_tokens=700, temperature=0.4))
    except Exception:
        return None
    if not isinstance(data, dict) or not data.get("sections"):
        return None
    # Resolve item numbers → links so the UI can render source attribution.
    out_sections = []
    for s in data.get("sections", [])[:4]:
        if not isinstance(s, dict):
            continue
        links = []
        for n in (s.get("items") or [])[:6]:
            try:
                it = feed[int(n) - 1]
            except (ValueError, TypeError, IndexError):
                continue
            links.append({"title": it.get("title", ""), "url": it.get("url", ""),
                          "source": it.get("source", "")})
        out_sections.append({
            "headline": str(s.get("headline", ""))[:200],
            "why": str(s.get("why", ""))[:400],
            "links": links,
        })
    if not out_sections:
        return None
    return {"summary": str(data.get("summary", ""))[:300], "sections": out_sections}


def _prev_delta(db, agent_id: str, day: str):
    """Yesterday's digest → (prev_row, exclude_ids, since_utc) for daily-delta
    scoping. "New and fresh since yesterday" means since the previous day's
    build (if one exists) or yesterday 00:00 local when there's no prior digest.
    Shared by build_digest (fresh) and quick_digest (instant) so both rank the
    same window."""
    prev_day = _previous_day(day)
    prev_row = None
    try:
        prev_row = db["reply_digest"].get(_digest_id(agent_id, prev_day))
    except Exception:
        pass
    exclude_ids: set = set()
    if prev_row:
        for it in json.loads(prev_row.get("feed_json") or "[]"):
            iid = it.get("id") or it.get("url")
            if iid:
                exclude_ids.add(iid)
        since_utc = int(prev_row.get("created_at") or _day_start_utc(prev_day))
    else:
        since_utc = _day_start_utc(prev_day)
    return prev_row, exclude_ids, since_utc


def quick_digest(agent_id: str | None = None, *, n: int = 40) -> dict:
    """Instant, read-only digest for first paint.

    Ranks the feed straight from the corpus already on disk — NO network
    collect, NO learn pass, NO LLM synthesis — so it returns in ~1-3s instead
    of the 15-35s a full build costs. Reuses the most recent cached briefing
    (today's partial if one exists, else yesterday's) so the briefing column
    shows content rather than an empty state while the full build runs in the
    background. Never persists — the full `build_digest` still runs and
    overwrites the daily row. Fail-soft.
    """
    db = init_reply_schema()
    a = get_agent(agent_id)
    if not a:
        return {"ok": False, "skipped": True, "reason": "no active agent",
                "quick": True, "briefing": None, "feed": [], "sources": {}}
    day = _today()
    # If today's full digest already exists, there's nothing to rush — hand it back.
    cached = current_digest(a["id"], day)
    if cached:
        return cached
    prev_row, exclude_ids, since_utc = _prev_delta(db, a["id"], day)
    feed = _fresh_items(a["id"], limit=n, since_utc=since_utc,
                        exclude_ids=exclude_ids)
    # Reuse the last briefing on file so the column isn't empty until the fresh
    # one lands. Flagged stale so the UI can treat it as provisional.
    briefing = None
    if prev_row:
        try:
            briefing = json.loads(prev_row.get("briefing_json") or "null")
        except Exception:
            briefing = None
    by_category: dict = {}
    for it in feed:
        by_category[it["category"]] = by_category.get(it["category"], 0) + 1
    return {"ok": True, "quick": True, "day": day, "briefing": briefing,
            "feed": feed,
            "sources": {"by_category": by_category, "item_count": len(feed),
                        "llm": bool(briefing), "collected": False,
                        "stale_briefing": bool(briefing)}}


def build_digest(agent_id: str | None = None, *, rebuild: bool = False,
                 collect_fresh: bool = True, learn: bool = True, n: int = 40,
                 provider: str | None = None, progress=None) -> dict:
    """Build (or return the cached) daily digest for the agent. Fail-soft.

    On a real build (first-of-day or `rebuild`) this:
      1. collects fresh items across News/Articles/Community/Research → corpus,
      2. runs one learn pass so the agent ingests them into memories + beliefs
         (the "brain") — set `learn=False` to skip,
      3. synthesizes a goal-framed briefing,
      4. caches one row/agent/day.
    """
    db = init_reply_schema()
    a = get_agent(agent_id)
    if not a:
        return {"ok": False, "skipped": True, "reason": "no active agent",
                "briefing": None, "feed": [], "sources": {}}
    day = _today()

    if not rebuild:
        cached = current_digest(a["id"], day)
        if cached:
            return cached

    def _p(msg: str) -> None:
        if progress:
            try:
                progress(msg)
            except Exception:
                pass

    # Daily-delta bookkeeping: "new and fresh since yesterday" means since the
    # previous day's digest build (if one exists) or since yesterday 00:00 local.
    _prev_row, exclude_ids, since_utc = _prev_delta(db, a["id"], day)

    collected = False
    by_source: dict = {}
    if collect_fresh:
        try:
            from ..research.collect import collect
            sources = _digest_sources_for_agent(a)
            _p(f"digest: fetching from {len(sources)} sources (product + persona aware)…")
            res = collect(
                topic=a["topic"], subs=None, sources=sources,
                skip_reddit=True, skip_extraction=True,
                extra_keywords=_agent_extra_keywords(a),
                progress=progress,
            )
            by_source = dict(getattr(res, "by_source", {}) or {})
            collected = True
        except Exception as e:
            _p(f"digest: news fetch skipped ({e})")

    # Ingest the freshly-collected corpus into the agent's brain (memories +
    # beliefs). Fail-soft: a learn miss must never break the digest.
    learned: dict = {}
    if learn and collected:
        try:
            from .learn import learn_for_agent
            _p("digest: learning from new items…")
            learned = learn_for_agent(a["id"], ingest_limit=25, progress=progress) or {}
        except Exception as e:
            _p(f"digest: learn skipped ({e})")

    feed = _fresh_items(a["id"], limit=n, since_utc=since_utc,
                        exclude_ids=exclude_ids)
    expanded = any(
        (it.get("created_utc") or 0) < since_utc for it in feed
    )
    by_category: dict = {}
    for it in feed:
        by_category[it["category"]] = by_category.get(it["category"], 0) + 1
    briefing = _synthesize(a, feed, provider)
    now = int(time.time())
    rec = {
        "id": _digest_id(a["id"], day), "agent_id": a["id"], "day": day,
        "briefing_json": json.dumps(briefing) if briefing else "",
        "feed_json": json.dumps(feed),
        "sources_json": json.dumps({
            "by_source": by_source, "by_category": by_category,
            "item_count": len(feed), "llm": bool(briefing),
            "collected": collected,
            "expanded": expanded,
            "fresh_since": since_utc,
            "learned": {"memories": learned.get("memories_added"),
                        "ingested": learned.get("ingested")} if learned else {},
        }),
        "created_at": now,
    }
    db["reply_digest"].upsert(rec, pk="id")
    try:
        from ..research.competitor_intel.digest_hook import competitor_moves
        _prod = a.get("product_id") or None
        moves = competitor_moves(_prod) if _prod else []
    except Exception:
        moves = []
    return {"ok": True, "cached": False, "day": day, "briefing": briefing,
            "feed": feed, "sources": json.loads(rec["sources_json"]),
            "competitor_moves": moves,
            "generated_at": now}


def search_news(agent_id: str | None = None, query: str = "", *, n: int = 20) -> dict:
    """On-demand news search over free, key-less sources (Google News + DuckDuckGo).
    Read-only: returns mapped feed items without persisting. Fail-soft."""
    q = (query or "").strip()
    if not q:
        return {"ok": False, "error": "empty query", "query": "", "results": []}
    rows: list[dict] = []
    try:
        from ..sources.gnews import fetch_gnews
        rows += fetch_gnews(q, limit=n) or []
    except Exception:
        pass
    try:
        from ..sources.duckduckgo import fetch_duckduckgo
        rows += fetch_duckduckgo(q, limit=n) or []
    except Exception:
        pass
    seen: set = set()
    out: list[dict] = []
    for r in rows:
        url = (r.get("url") or "").strip()
        key = url or (r.get("title") or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({
            "title": (r.get("title") or "").strip()[:240],
            "url": url,
            "source": r.get("source_type") or "",
            "sub": r.get("sub") or "",
            "category": _category_of(r.get("source_type") or ""),
            "score": 0,
            "created_utc": r.get("created_utc"),
            "snippet": (r.get("selftext") or "").strip()[:240],
        })
    out.sort(key=lambda it: it.get("created_utc") or 0, reverse=True)
    return {"ok": True, "query": q, "results": out[:n]}
