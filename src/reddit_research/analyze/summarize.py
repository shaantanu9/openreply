"""Summarize a Reddit thread (post + top comments)."""
from __future__ import annotations

from textwrap import dedent

from ..core.db import get_db
from .providers.base import get_provider

SYSTEM = dedent(
    """
    You are a concise research assistant. Summarize this Reddit thread in at most
    8 bullet points: the main question/claim, the leading opinions, notable
    disagreements, and any actionable advice. Do not repeat usernames.
    """
).strip()


def summarize_thread(post_id: str, provider: str = "anthropic") -> str:
    db = get_db()
    post = db["posts"].get(post_id)
    comments = list(
        db.query(
            "SELECT author, body, score FROM comments "
            "WHERE post_id = ? ORDER BY score DESC LIMIT 50",
            [post_id],
        )
    )
    post_text = f"# {post['title']}\n\n{post.get('selftext') or ''}"
    comments_text = "\n\n".join(f"({c['score']}) {c['body']}" for c in comments)
    llm = get_provider(provider)
    return llm.complete(
        prompt=f"{post_text}\n\n---\nTop comments:\n{comments_text}",
        system=SYSTEM,
        max_tokens=1024,
    )
