"""chat_meta — lightweight metadata for the chat UI (provider + corpus + palace).

What the UI shows BEFORE the first token: which provider/model will answer, how
many posts back this topic, and whether semantic retrieval is available/indexed.
"""
from __future__ import annotations

from ...core.db import get_db
from .llm_dispatch import _resolve_provider


def chat_meta(topic: str, provider: str | None = None) -> dict:
    """Return a small dict describing what will be used + the current corpus size."""
    prov, model = _resolve_provider(provider)
    db = get_db()
    posts = list(db.query("SELECT count(*) AS n FROM topic_posts WHERE topic=?", (topic,)))

    # Surface Palace (semantic retrieval) status so the chat UI can show
    # whether questions will be answered from semantic search or fall back
    # to engagement-ranked SQL.
    palace_status: dict = {"available": False, "model_ready": False, "indexed_for_topic": 0}
    try:
        from ...retrieval import palace
        palace_status["available"] = palace.is_available()
        palace_status["model_ready"] = palace_status["available"] and palace.is_model_ready()
        if palace_status["model_ready"]:
            stats = palace.stats() or {}
            # stats may include a per-topic breakdown; surface this topic's count.
            by_topic = (stats.get("by_topic") or {}) if isinstance(stats, dict) else {}
            palace_status["indexed_for_topic"] = int(by_topic.get(topic, 0) or 0)
            palace_status["indexed_total"] = int(stats.get("count", 0) or 0)
    except Exception:
        pass

    return {
        "topic": topic,
        "provider": prov,
        "model": model,
        "posts": posts[0]["n"] if posts else 0,
        "palace": palace_status,
    }
