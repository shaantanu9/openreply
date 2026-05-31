"""Simple saturation metric v1: new graph clusters per 50 new posts.

High score → each new post adds a distinct insight; low score → diminishing
returns, user should try a new source or stop collecting. No LLM, pure SQL.

Schema note (2026-04-21): `graph_edges` uses columns `src`/`dst` (not
source/target). Cluster-kind edges that land on a post are
`evidenced_by` (painpoint/workaround/… → post). Post-node IDs follow
the `<topic>::post::<post_id>` format — we reconstruct that directly
instead of a substring LIKE join.
"""
from __future__ import annotations

from ..core.db import get_db

# Node kinds that count as a distinct insight cluster. Meta kinds
# (post, topic, subreddit, user, source, era) are excluded so we don't
# inflate the score with structural nodes.
_CLUSTER_KINDS = (
    "painpoint", "feature_wish", "workaround", "product",
    "intervention", "mechanism", "evidence_paper",
)


def compute(topic: str) -> dict:
    db = get_db()
    placeholders = ",".join(f":k{i}" for i in range(len(_CLUSTER_KINDS)))
    params = {"topic": topic}
    params.update({f"k{i}": k for i, k in enumerate(_CLUSTER_KINDS)})
    rows = list(db.query(f"""
        WITH recent_posts AS (
          SELECT post_id, added_at FROM topic_posts
           WHERE topic = :topic ORDER BY added_at DESC LIMIT 50
        )
        SELECT count(DISTINCT gn.id) AS clusters,
               (SELECT min(added_at) FROM recent_posts) AS window_start
          FROM recent_posts rp
          LEFT JOIN graph_edges ge
            ON ge.dst = (:topic || '::post::' || rp.post_id)
           AND ge.topic = :topic
           AND ge.kind = 'evidenced_by'
          LEFT JOIN graph_nodes gn
            ON gn.id = ge.src
           AND gn.topic = :topic
           AND gn.kind IN ({placeholders})
    """, params))
    r = rows[0] if rows else {"clusters": 0, "window_start": None}
    clusters = int(r.get("clusters") or 0)

    score = round(clusters / 50.0, 3)
    if score >= 0.20:
        hint = "rich"
    elif score >= 0.05:
        hint = "converging"
    else:
        hint = "saturated"
    return {
        "score": score,
        "hint": hint,
        "new_clusters_last_50_posts": clusters,
        "window_start": r.get("window_start"),
    }
