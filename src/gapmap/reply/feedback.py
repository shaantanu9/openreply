"""Opportunity-lifecycle feedback → learning signal.

The lifecycle the UI drives (Save / Reply / Dismiss) is the cheapest, truest
signal of what's worth engaging. We close it back into the system:

  - **engaged** (Saved or Replied): the underlying post is upserted into `posts`
    and tagged to the agent's topic, so the next learning pass distills it into a
    (high-value) memory — engaging *is* the "learn from this" vote.
  - **dismissed** (Skipped): recorded so `find_opportunities` stops resurfacing
    that exact post.

Best-effort: every function returns a status/value and never raises, so a
feedback write can't break a status change or a find.
"""
from __future__ import annotations

import time

from .schema import init_reply_schema


def _opp(db, opportunity_id: str) -> dict | None:
    try:
        return dict(db["reply_opportunities"].get(opportunity_id))
    except Exception:
        return None


def record_opportunity_feedback(opportunity_id: str, signal: str) -> dict:
    """Record an `engaged` | `dismissed` signal for an opportunity. Never raises."""
    signal = (signal or "").strip().lower()
    if signal not in ("engaged", "dismissed"):
        return {"ok": False, "error": f"bad signal '{signal}'"}
    db = init_reply_schema()
    opp = _opp(db, opportunity_id)
    if not opp:
        return {"ok": False, "error": "no such opportunity"}

    excerpt = (opp.get("body") or opp.get("title") or "")[:500]
    row = {
        "opportunity_id": opportunity_id,
        "agent_id": opp.get("brand_id") or "default",
        "post_id": opp.get("post_id") or "",
        "platform": opp.get("platform") or "",
        "signal": signal,
        "title": (opp.get("title") or "")[:300],
        "excerpt": excerpt,
        "created_at": int(time.time()),
    }
    try:
        db["reply_feedback"].upsert(row, pk="opportunity_id")
    except Exception:
        pass

    if signal == "engaged":
        _seed_corpus(opp)
    return {"ok": True, "opportunity_id": opportunity_id, "signal": signal}


def _seed_corpus(opp: dict) -> None:
    """Upsert an engaged opportunity's post into `posts` + tag it to the agent's
    topic so the next ingest learns from it. Idempotent; never raises."""
    try:
        from ..core.db import upsert_posts
        from ..research.collect import _tag_posts
        from .agent import get_agent

        pid = str(opp.get("post_id") or "").strip()
        if not pid:
            return
        platform = opp.get("platform") or "reply"
        now = int(time.time())
        post = {
            "id": pid,
            "sub": opp.get("sub") or platform,
            "source_type": platform,
            "author": opp.get("author") or "",
            "title": opp.get("title") or "",
            "selftext": opp.get("body") or "",
            "url": opp.get("url") or "",
            "score": int(opp.get("engagement") or 0) if str(opp.get("engagement") or "").replace(".", "").isdigit() else 0,
            "upvote_ratio": None,
            "num_comments": 0,
            "created_utc": float(opp.get("found_at") or now),
            "is_self": 1,
            "over_18": 0,
            "flair": "engaged",
            "permalink": opp.get("url") or "",
            "fetched_at": now,
        }
        upsert_posts([post])
        agent = get_agent(opp.get("brand_id"))
        topic = (agent or {}).get("topic")
        if topic:
            _tag_posts(topic, [pid], f"feedback:{platform}")
    except Exception:
        pass


def dismissed_post_ids(agent_id: str | None = None) -> set[str]:
    """Post ids the user dismissed — `find_opportunities` skips these so a
    dismissed conversation never resurfaces. Never raises."""
    db = init_reply_schema()
    try:
        if agent_id:
            rows = db["reply_feedback"].rows_where("signal = ? AND agent_id = ?",
                                                   ["dismissed", agent_id])
        else:
            rows = db["reply_feedback"].rows_where("signal = ?", ["dismissed"])
        return {str(r["post_id"]) for r in rows if r.get("post_id")}
    except Exception:
        return set()


def feedback_counts(agent_id: str | None = None) -> dict:
    """{'engaged': n, 'dismissed': m} for the Learning UI. Never raises."""
    db = init_reply_schema()
    out = {"engaged": 0, "dismissed": 0}
    try:
        where = "agent_id = ?" if agent_id else "1=1"
        args = [agent_id] if agent_id else []
        for r in db["reply_feedback"].rows_where(where, args):
            s = r.get("signal")
            if s in out:
                out[s] += 1
    except Exception:
        pass
    return out
