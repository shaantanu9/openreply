"""Head-to-head comparison: your product vs each tracked competitor."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from . import registry
from .sweep import latest_snapshot


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _product_topic(product_id: str) -> str | None:
    # The `products` table is never populated; resolve the topic via the agent
    # record instead — `product_id` is the agent id.
    try:
        from ...reply.agent import get_agent

        a = get_agent(product_id)
        return a.get("topic") if a else None
    except Exception:
        return None


def _sentiment(topic: str, provider: str | None):
    from ...analyze.sentiment import sentiment_by_source

    return sentiment_by_source(topic, provider=provider)


def _latest(product_id: str, name: str):
    return latest_snapshot(product_id, name)


def build_comparison(product_id: str, provider: str | None = None) -> dict[str, Any]:
    you = {"sentiment": 0.0, "complaint_count": 0}
    topic = _product_topic(product_id)
    if topic:
        s = _sentiment(topic, provider)
        you["sentiment"] = s.get("overall", 0.0)

    comps: list[dict[str, Any]] = []
    for c in registry.list_competitors(product_id, active_only=True):
        snap = _latest(product_id, c["competitor_name"]) or {}
        m = snap.get("metrics", {})
        mentions = sum((m.get("mentions_by_source") or {}).values())
        comps.append(
            {
                "name": c["competitor_name"],
                "sentiment": m.get("sentiment_score", 0.0),
                "complaint_count": m.get("complaint_count", 0),
                "top_painpoints": m.get("top_painpoints", []),
                "_mentions": mentions,
            }
        )
    total = sum(c["_mentions"] for c in comps) or 1
    for c in comps:
        c["share_of_voice"] = round(c.pop("_mentions") / total, 6)
    return {"you": you, "competitors": comps, "generated_at": _now()}
