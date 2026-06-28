"""Extract concrete user pain points from a set of posts — useful for product research."""
from __future__ import annotations

import json
from textwrap import dedent

from ..core.db import get_db
from .providers.base import get_provider

SYSTEM = dedent(
    """
    You are a product researcher. From these Reddit posts, extract the distinct
    pain points users are expressing. Be specific (not generic). For each:
    - quote a short phrase from the post that evidences it
    - tag its severity (low/medium/high) based on user sentiment
    - estimate frequency from the sample

    Reply with JSON only. Schema:
    [{"painpoint": str, "evidence": str, "severity": str, "frequency": int, "example_post_ids": [str]}]
    """
).strip()


def extract_painpoints(
    sub: str | None = None,
    since_days: int | None = None,
    top: int = 50,
    provider: str | None = None,
) -> list[dict]:
    db = get_db()
    where, params = [], []
    if sub:
        where.append("sub = ?")
        params.append(sub.lower())
    if since_days:
        where.append("created_utc >= strftime('%s','now') - ?")
        params.append(since_days * 86400)
    sql = "SELECT id, title, substr(selftext, 1, 800) AS excerpt FROM posts"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY score DESC LIMIT ?"
    params.append(top)
    rows = list(db.query(sql, params))
    if not rows:
        return []

    posts_text = "\n\n".join(f"[{r['id']}] {r['title']}\n{r.get('excerpt') or ''}" for r in rows)
    raw = get_provider(provider).complete(
        prompt=f"Posts:\n\n{posts_text}", system=SYSTEM, max_tokens=2048
    )
    try:
        cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return [{"_raw": raw, "_parse_error": True}]
