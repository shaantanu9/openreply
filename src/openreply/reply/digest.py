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
import time

from ..analyze.providers.base import get_provider
from .agent import get_agent
from .schema import init_reply_schema
from .util import loads_json

# Sources grouped into the four learning buckets the Overview feed renders.
# Reddit stays OUT — it's the reply/Opportunities surface, not "what's new in the
# world." These keys are all valid `research.collect(sources=…)` entries.
CATEGORY_SOURCES = {
    "news":      ["gnews", "rss_tech_news", "rss_products", "duckduckgo"],
    "articles":  ["devto", "hn", "github"],
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


def _fresh_items(agent_id: str, *, days: int = 7, limit: int = 40,
                 per_cat_floor: int = 3) -> list[dict]:
    """Top-N freshest, highest-signal corpus items for the agent, ranked by
    freshness x engagement x source weight and tagged with a feed category.
    Reads the shared corpus via `list_corpus` (no parallel fetcher). Guarantees
    each category's top `per_cat_floor` items appear (so the pills aren't empty),
    then fills the rest by global score."""
    from .library import list_corpus
    from .rank import engagement_score, freshness, platform_weight

    try:
        res = list_corpus(agent_id, limit=240, offset=0)
    except Exception:
        return []
    items = (res or {}).get("items") or []
    now = time.time()
    cutoff = now - days * 86400
    scored: list[tuple[float, dict]] = []
    for it in items:
        # Drop items the relevance gate marked off-topic.
        if it.get("relevant") == 0:
            continue
        cu = it.get("created_utc")
        # Keep recent items; undated items (cu falsy) survive and get a neutral
        # freshness from rank.freshness() so key-less sources still surface.
        if cu and cu < cutoff:
            continue
        post = {"score": it.get("score"), "num_comments": it.get("comments"),
                "created_utc": cu}
        fr = freshness(post, now)
        eng = engagement_score(post)
        src = it.get("source") or ""
        w = platform_weight(src.split("_")[0] if src.startswith("rss") else src)
        final = 0.55 * fr + 0.25 * eng + 0.20 * w
        scored.append((final, it))
    scored.sort(key=lambda t: t[0], reverse=True)

    # Balanced selection: each category's top `per_cat_floor` first, then fill
    # the remainder by global rank — deduped by item id.
    chosen: list[tuple[float, dict]] = []
    seen: set = set()
    by_cat: dict[str, list[tuple[float, dict]]] = {}
    for final, it in scored:
        by_cat.setdefault(_category_of(it.get("source") or ""), []).append((final, it))
    for lst in by_cat.values():
        for final, it in lst[:per_cat_floor]:
            iid = it.get("id") or it.get("url")
            if iid in seen:
                continue
            seen.add(iid)
            chosen.append((final, it))
    for final, it in scored:
        if len(chosen) >= limit:
            break
        iid = it.get("id") or it.get("url")
        if iid in seen:
            continue
        seen.add(iid)
        chosen.append((final, it))
    chosen.sort(key=lambda t: t[0], reverse=True)
    return [_to_feed_item(it, final) for final, it in chosen[:limit]]


def _goal_block(a: dict) -> str:
    goal = (a.get("goal") or a.get("objective") or "").strip()
    kws = ", ".join((a.get("keywords") or [])[:12])
    return (
        f"GOAL: {goal or '(grow the product helpfully)'}\n"
        f"Niche: {a.get('niche') or a.get('topic') or '-'}\n"
        f"Product: {a.get('product') or a.get('brand') or '-'}\n"
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

    collected = False
    by_source: dict = {}
    if collect_fresh:
        try:
            from ..research.collect import collect
            _p("digest: fetching fresh news, articles, community & research…")
            res = collect(topic=a["topic"], subs=None, sources=DIGEST_SOURCES,
                          skip_reddit=True, skip_extraction=True, progress=progress)
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

    feed = _fresh_items(a["id"], limit=n)
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
            "learned": {"memories": learned.get("memories_added"),
                        "ingested": learned.get("ingested")} if learned else {},
        }),
        "created_at": now,
    }
    db["reply_digest"].upsert(rec, pk="id")
    return {"ok": True, "cached": False, "day": day, "briefing": briefing,
            "feed": feed, "sources": json.loads(rec["sources_json"]),
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
