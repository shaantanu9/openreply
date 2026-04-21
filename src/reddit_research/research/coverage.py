"""Coverage gap analyzer: which data dimensions are underrepresented.

Reads the topic's corpus composition by `posts.source_type`, buckets it
into UX-friendly dimensions (reviews / academic / news / technical),
and flags any dimension whose share of posts falls below its threshold.
Also emits a "competitors" gap when distinct product mentions are thin.

Pure SQL; no LLM. Used by the topic page's "Coverage gaps" panel to
suggest one-click enrichments via the existing collect pipeline.
"""
from __future__ import annotations

from ..core.db import get_db

# Dimensions and the minimum-post thresholds that trigger a gap suggestion.
# source_types list matches what the collect pipeline writes into
# posts.source_type; suggested_sources is the subset we offer as a
# one-click "+ Add X" button.
_DIMENSIONS = [
    {
        "id": "user_reviews", "label": "User reviews",
        "source_types": ["appstore", "playstore"],
        "suggested_sources": ["appstore", "playstore"],
        "min_pct": 5.0,
    },
    {
        "id": "academic", "label": "Academic evidence",
        "source_types": ["arxiv", "openalex", "pubmed", "scholar"],
        "suggested_sources": ["arxiv", "openalex"],
        "min_pct": 3.0,
    },
    {
        "id": "news", "label": "News + trends",
        "source_types": ["gnews", "trends"],
        "suggested_sources": ["gnews"],
        "min_pct": 3.0,
    },
    {
        "id": "technical", "label": "Technical / dev community",
        "source_types": ["hn", "stackoverflow", "devto", "github"],
        "suggested_sources": ["hn", "stackoverflow"],
        "min_pct": 3.0,
    },
]


def compute(topic: str) -> dict:
    db = get_db()
    rows = list(db.query("""
        SELECT coalesce(p.source_type, 'reddit') AS src, count(*) AS n
          FROM topic_posts tp JOIN posts p ON p.id = tp.post_id
         WHERE tp.topic = :topic
         GROUP BY src
    """, {"topic": topic}))
    total = sum(int(r["n"]) for r in rows) or 1
    by_src = {r["src"]: int(r["n"]) for r in rows}

    gaps = []
    for dim in _DIMENSIONS:
        n = sum(by_src.get(s, 0) for s in dim["source_types"])
        pct = round(n / total * 100, 1)
        if pct < dim["min_pct"]:
            gaps.append({
                "id": dim["id"], "label": dim["label"],
                "posts": n, "pct": pct,
                "suggested_sources": dim["suggested_sources"],
            })

    # Deepen products — flag when we have fewer than 3 distinct product
    # labels extracted for this topic. Signals that the LLM extraction
    # hasn't surfaced enough competitor mentions yet.
    prod_rows = list(db.query("""
        SELECT count(DISTINCT label) AS n
          FROM graph_nodes WHERE topic = :topic AND kind = 'product'
    """, {"topic": topic}))
    distinct_products = int(prod_rows[0]["n"]) if prod_rows else 0
    if distinct_products < 3:
        gaps.append({
            "id": "competitors", "label": "Competitor mentions",
            "posts": distinct_products, "pct": None,
            "suggested_sources": ["deepen_products"],
        })

    return {"total_posts": total, "by_source": by_src, "gaps": gaps}
