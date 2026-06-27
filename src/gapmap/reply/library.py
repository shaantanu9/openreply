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

from .agent import get_agent
from .schema import init_reply_schema

# Free, no-auth discovery sources every agent should pull into its corpus so the
# brain learns from news / web / forums / communities, not just reply targets.
DEFAULT_DISCOVERY_SOURCES = [
    "hn", "devto", "stackoverflow", "producthunt", "lemmy", "mastodon",
    "gnews", "rss_tech_news", "duckduckgo",
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
    topic = a.get("topic") or a.get("name")
    db = init_reply_schema()

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
    wsql = " AND ".join(where)

    total = (_q(
        f"SELECT COUNT(*) FROM posts p JOIN topic_posts tp ON tp.post_id = p.id WHERE {wsql}",
        args,
    ) or [[0]])[0][0]

    rows = _q(
        f"SELECT p.id, p.source_type, p.sub, p.author, p.title, p.selftext, "
        f"       p.url, p.permalink, p.score, p.num_comments, p.created_utc "
        f"FROM posts p JOIN topic_posts tp ON tp.post_id = p.id "
        f"WHERE {wsql} ORDER BY COALESCE(p.created_utc, 0) DESC LIMIT ? OFFSET ?",
        args + [int(limit), int(offset)],
    )
    items = [{
        "id": r[0], "source": r[1], "sub": r[2], "author": r[3],
        "title": (r[4] or "").strip(),
        "snippet": (r[5] or "").strip()[:320],
        "url": r[6] or r[7] or "",
        "score": r[8], "comments": r[9], "created_utc": r[10],
    } for r in rows]

    return {
        "agent": a["name"], "topic": topic,
        "total": total, "total_all": total_all,
        "sources": [{"source": s, "count": c} for s, c in counts],
        "items": items,
    }
