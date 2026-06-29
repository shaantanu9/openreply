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

# Fast, news-leaning sources for the light fresh top-up (no Reddit — that's the
# reply surface, kept out of the "what's new in the world" fetch). Heavy/academic
# fetchers stay out; this must stay quick enough for an on-open build.
NEWS_SOURCES = ["gnews", "hn", "rss_tech_news", "rss_products", "devto", "arxiv", "github", "duckduckgo"]

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


def _fresh_items(agent_id: str, *, days: int = 3, limit: int = 12) -> list[dict]:
    """Top-N freshest, highest-signal corpus items for the agent, ranked by
    freshness x engagement x source weight. Reads the shared corpus via
    `list_corpus` (no parallel fetcher)."""
    from .library import list_corpus
    from .rank import engagement_score, freshness, platform_weight

    try:
        res = list_corpus(agent_id, limit=120, offset=0)
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
        # Keep recent items; items with no date get a neutral-low freshness but
        # are only kept if we're short on dated ones (handled by the sort).
        if cu and cu < cutoff:
            continue
        post = {"score": it.get("score"), "num_comments": it.get("comments"),
                "created_utc": cu}
        fr = freshness(post, now)
        eng = engagement_score(post)
        w = platform_weight((it.get("source") or "").split("_")[0] if (it.get("source") or "").startswith("rss") else (it.get("source") or ""))
        final = 0.55 * fr + 0.25 * eng + 0.20 * w
        scored.append((final, it))
    scored.sort(key=lambda t: t[0], reverse=True)
    out: list[dict] = []
    for final, it in scored[:limit]:
        out.append({
            "title": (it.get("title") or "").strip()[:240],
            "url": it.get("url") or "",
            "source": it.get("source") or "",
            "sub": it.get("sub") or "",
            "score": round(final, 4),
            "created_utc": it.get("created_utc"),
            "snippet": (it.get("snippet") or "").strip()[:240],
        })
    return out


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
                 collect_fresh: bool = True, n: int = 12,
                 provider: str | None = None, progress=None) -> dict:
    """Build (or return the cached) daily digest for the agent. Fail-soft."""
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

    collected = False
    by_source: dict = {}
    if collect_fresh:
        try:
            from ..research.collect import collect
            res = collect(topic=a["topic"], subs=None, sources=NEWS_SOURCES,
                          skip_reddit=True, skip_extraction=True, progress=progress)
            by_source = dict(getattr(res, "by_source", {}) or {})
            collected = True
        except Exception as e:
            if progress:
                try:
                    progress(f"digest: news fetch skipped ({e})")
                except Exception:
                    pass

    feed = _fresh_items(a["id"], limit=n)
    briefing = _synthesize(a, feed, provider)
    now = int(time.time())
    rec = {
        "id": _digest_id(a["id"], day), "agent_id": a["id"], "day": day,
        "briefing_json": json.dumps(briefing) if briefing else "",
        "feed_json": json.dumps(feed),
        "sources_json": json.dumps({"by_source": by_source, "item_count": len(feed),
                                    "llm": bool(briefing), "collected": collected}),
        "created_at": now,
    }
    db["reply_digest"].upsert(rec, pk="id")
    return {"ok": True, "cached": False, "day": day, "briefing": briefing,
            "feed": feed, "sources": json.loads(rec["sources_json"]),
            "generated_at": now}
