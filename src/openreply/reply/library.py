"""Content Library — browse the agent's collected multi-source corpus.

Every refresh/collect pulls posts, articles, threads and comments about the
agent's niche from many sources (Reddit, Hacker News, Lemmy, Mastodon, Dev.to,
Stack Overflow, Product Hunt, Google News, RSS, the web, …) into the shared
`posts` table, tagged to the topic via `topic_posts`. Until now that corpus was
only consumed internally (ranking, knowledge blend) — there was no way to *see*
it. This module exposes it so the user can read source material from ALL
sources, learn from it, and turn it into new posts/threads/articles.

`corpus_sources()` also defines the broad source set an agent collects into its
corpus — its picked reply platforms PLUS free discovery sources (news / RSS /
web / communities) PLUS anything connected in Reach Connections — so the brain
learns from the whole landscape, not just where it can reply.
"""
from __future__ import annotations

from .agent import agent_corpus_topic, get_agent
from .schema import init_reply_schema

# Free, no-auth discovery sources every agent should pull into its corpus so the
# brain learns from news / web / forums / communities / science / code, not just
# reply targets. Keep these to the fast, reliable fetchers; heavy/academic ones
# (pubmed / openalex / appstore / playstore / trends / gdelt) stay opt-in via
# aggressive collect or explicit --sources.
DEFAULT_DISCOVERY_SOURCES = [
    "hn", "devto", "stackoverflow", "producthunt", "lemmy", "mastodon",
    "gnews", "rss_tech_news", "rss_products", "rss_user", "duckduckgo",
    "github", "arxiv",
]


def corpus_sources(agent: dict) -> list[str]:
    """The full source set an agent collects into its corpus: picked platforms
    + free discovery sources + connected Reach sources, deduped. Reddit is always
    included as the baseline."""
    out: list[str] = []
    for s in (list(agent.get("platforms") or []) + ["reddit_free"] + DEFAULT_DISCOVERY_SOURCES):
        if s and s not in out:
            out.append(s)
    try:
        from ..research.reach_connections import connected_collection_sources
        for s in connected_collection_sources():
            if s and s not in out:
                out.append(s)
    except Exception:
        pass
    return out


def list_corpus(
    agent_id: str | None = None,
    *,
    source: str | None = None,
    query: str | None = None,
    relevance: str | None = None,  # None=all | "on" | "off" | "unchecked"
    limit: int = 60,
    offset: int = 0,
) -> dict:
    """Browse the agent's collected corpus across all sources. Read-only.

    Returns per-source counts (for filter chips) + a page of items
    (title, snippet, source, author, community, url, score, age). Never raises.
    """
    a = get_agent(agent_id)
    if not a:
        return {"error": "no such agent"}
    topic = agent_corpus_topic(a)
    db = init_reply_schema()
    # Ensure the relevance table exists so the LEFT JOIN below never errors.
    try:
        from .relevance import _ensure as _ensure_rel
        _ensure_rel(db)
    except Exception:
        pass

    def _q(sql, args):
        try:
            return db.execute(sql, args).fetchall()
        except Exception:
            return []

    counts = _q(
        "SELECT p.source_type, COUNT(*) FROM posts p "
        "JOIN topic_posts tp ON tp.post_id = p.id "
        "WHERE tp.topic = ? GROUP BY p.source_type ORDER BY 2 DESC",
        [topic],
    )
    total_all = sum(c for _, c in counts)

    where = ["tp.topic = ?"]
    args: list = [topic]
    if source:
        where.append("p.source_type LIKE ?")
        args.append(f"{source}%")
    if query:
        where.append("(lower(p.title) LIKE ? OR lower(p.selftext) LIKE ?)")
        q = f"%{query.lower()}%"
        args += [q, q]
    wsql_base = " AND ".join(where)  # topic/source/query only — for the global tally
    # Relevance filter (literal, no bound params) applies only to the item list/total.
    rel_clause = {"on": "pr.relevant = 1", "off": "pr.relevant = 0",
                  "unchecked": "pr.relevant IS NULL"}.get(relevance or "")
    wsql = wsql_base + (f" AND {rel_clause}" if rel_clause else "")

    total = (_q(
        f"SELECT COUNT(*) FROM posts p JOIN topic_posts tp ON tp.post_id = p.id "
        f"LEFT JOIN post_relevance pr ON pr.topic = tp.topic AND pr.post_id = p.id WHERE {wsql}",
        args,
    ) or [[0]])[0][0]

    # Relevance gate: LEFT JOIN the LLM verdict; push off-topic items to the
    # bottom (relevant=0 last; on-topic + not-yet-checked first), then by recency.
    rows = _q(
        f"SELECT p.id, p.source_type, p.sub, p.author, p.title, p.selftext, "
        f"       p.url, p.permalink, p.score, p.num_comments, p.created_utc, "
        f"       pr.relevant, pr.score, pr.reason "
        f"FROM posts p JOIN topic_posts tp ON tp.post_id = p.id "
        f"LEFT JOIN post_relevance pr ON pr.topic = tp.topic AND pr.post_id = p.id "
        f"WHERE {wsql} "
        f"ORDER BY (CASE WHEN pr.relevant = 0 THEN 1 ELSE 0 END), "
        f"         COALESCE(p.created_utc, 0) DESC LIMIT ? OFFSET ?",
        args + [int(limit), int(offset)],
    )
    items = [{
        "id": r[0], "source": r[1], "sub": r[2], "author": r[3],
        "title": (r[4] or "").strip(),
        "snippet": (r[5] or "").strip()[:320],
        "url": r[6] or r[7] or "",
        "score": r[8], "comments": r[9], "created_utc": r[10],
        # None = not yet checked, 1 = on-topic, 0 = off-topic
        "relevant": (None if r[11] is None else int(r[11])),
        "rel_score": r[12], "rel_reason": r[13],
    } for r in rows]

    # Whole-corpus relevance tally (for the header + the "N unchecked" prompt).
    rel_counts = _q(
        f"SELECT COALESCE(pr.relevant, -1), COUNT(*) "
        f"FROM posts p JOIN topic_posts tp ON tp.post_id = p.id "
        f"LEFT JOIN post_relevance pr ON pr.topic = tp.topic AND pr.post_id = p.id "
        f"WHERE {wsql_base} GROUP BY COALESCE(pr.relevant, -1)",
        args,
    )
    cmap = {int(k): c for k, c in rel_counts}

    return {
        "agent": a["name"], "topic": topic,
        "total": total, "total_all": total_all,
        "sources": [{"source": s, "count": c} for s, c in counts],
        "relevance": {"on_topic": cmap.get(1, 0), "off_topic": cmap.get(0, 0),
                      "unchecked": cmap.get(-1, 0)},
        "items": items,
    }
