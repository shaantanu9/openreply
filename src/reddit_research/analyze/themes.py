"""Cluster posts into themes via LLM."""
from __future__ import annotations

import json
from textwrap import dedent

from ..core.db import get_db
from .providers.base import get_provider

SYSTEM = dedent(
    """
    You are a research assistant. Given a list of Reddit post titles and excerpts,
    identify 3–7 distinct themes. For each theme, give a short name, a one-sentence
    description, the count of posts in it, and up to 5 representative post IDs.
    Reply with a JSON array only, no preamble.
    Schema: [{"theme": str, "description": str, "count": int, "example_ids": [str]}]
    """
).strip()


def _fetch_rows(sub: str | None, since_days: int | None, limit: int) -> list[dict]:
    db = get_db()
    where = []
    params: list = []
    if sub:
        where.append("sub = ?")
        params.append(sub.lower())
    if since_days:
        where.append("created_utc >= strftime('%s','now') - ?")
        params.append(since_days * 86400)
    sql = "SELECT id, title, substr(selftext, 1, 500) AS excerpt FROM posts"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY score DESC LIMIT ?"
    params.append(limit)
    return list(db.query(sql, params))


def analyze_themes(
    sub: str | None = None,
    since_days: int | None = None,
    limit: int = 100,
    provider: str = "anthropic",
) -> list[dict]:
    rows = _fetch_rows(sub, since_days, limit)
    if not rows:
        return []
    posts_text = "\n\n".join(
        f"[{r['id']}] {r['title']}\n{r.get('excerpt') or ''}" for r in rows
    )
    llm = get_provider(provider)
    raw = llm.complete(
        prompt=f"Posts to analyze:\n\n{posts_text}",
        system=SYSTEM,
        max_tokens=2048,
    )
    try:
        # Strip possible code fences
        cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return [{"_raw": raw, "_parse_error": True}]
