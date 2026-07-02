"""Watched accounts — track specific creators/competitors on X (and other
platforms) and pull their posts into the agent's corpus + knowledge base.

Use it to learn from people you admire or compete with: track their handles,
fetch their recent posts, and they flow into the same corpus (`posts` +
`topic_posts`) that powers Library, the knowledge blend, and learning — so you
can read, repurpose and rewrite their ideas in your own voice from Compose.

X fetch reuses the existing backend chain (`sources.x_twitter.fetch_x`) via the
`from:<handle>` search operator — no new scraper, and it uses your connected X
login automatically. Never raises; returns status dicts.
"""
from __future__ import annotations

import time

from .agent import active_id, agent_corpus_topic, get_agent
from .schema import init_reply_schema

# platform -> how to turn a handle into a fetch query + the source_type tag.
_PLATFORMS = {
    "x": {"label": "X / Twitter", "query": lambda h: f"from:{h}"},
}


def _ensure(db):
    if "reply_accounts" not in set(db.table_names()):
        db["reply_accounts"].create(
            {
                "agent_id": str, "platform": str, "handle": str,
                "tracked": int, "note": str,
                "last_fetched_at": int, "posts_count": int, "added_at": int,
            },
            pk=("agent_id", "platform", "handle"),
        )
        db["reply_accounts"].create_index(["agent_id"])
    return db


def _norm(handle: str) -> str:
    h = (handle or "").strip().lstrip("@")
    # accept a full URL too: x.com/<handle>
    if "/" in h:
        h = h.rstrip("/").split("/")[-1]
    return h


def track_account(handle: str, *, platform: str = "x", note: str = "",
                  agent_id: str | None = None) -> dict:
    """Start watching an account. Returns the stored row."""
    h = _norm(handle)
    if not h:
        return {"error": "handle required"}
    if platform not in _PLATFORMS:
        return {"error": f"unsupported platform '{platform}'"}
    db = _ensure(init_reply_schema())
    aid = agent_id or active_id() or "default"
    existing = None
    try:
        existing = dict(db["reply_accounts"].get((aid, platform, h)))
    except Exception:
        existing = None
    rec = {
        "agent_id": aid, "platform": platform, "handle": h,
        "tracked": 1, "note": note or (existing or {}).get("note", ""),
        "last_fetched_at": (existing or {}).get("last_fetched_at", 0),
        "posts_count": (existing or {}).get("posts_count", 0),
        "added_at": (existing or {}).get("added_at") or int(time.time()),
    }
    db["reply_accounts"].upsert(rec, pk=("agent_id", "platform", "handle"))
    return rec


def untrack_account(handle: str, *, platform: str = "x", agent_id: str | None = None) -> dict:
    h = _norm(handle)
    db = _ensure(init_reply_schema())
    aid = agent_id or active_id() or "default"
    try:
        db["reply_accounts"].update((aid, platform, h), {"tracked": 0})
    except Exception:
        return {"ok": False, "handle": h}
    return {"ok": True, "handle": h, "tracked": False}


def list_accounts(*, platform: str | None = None, agent_id: str | None = None) -> dict:
    db = _ensure(init_reply_schema())
    aid = agent_id or active_id() or "default"
    where = "agent_id = ?"
    args: list = [aid]
    if platform:
        where += " AND platform = ?"
        args.append(platform)
    try:
        rows = [dict(r) for r in db["reply_accounts"].rows_where(
            where + " AND tracked = 1", args, order_by="last_fetched_at desc")]
    except Exception:
        rows = []
    return {"agent": (get_agent(aid) or {}).get("name", aid), "accounts": rows}


def fetch_account(handle: str, *, platform: str = "x", limit: int = 25,
                  agent_id: str | None = None, learn: bool = False) -> dict:
    """Fetch an account's recent posts and tag them into the agent's corpus
    (so they show in Library + feed the knowledge blend). Optionally run a learn
    pass so they become memories/beliefs immediately. Never raises."""
    h = _norm(handle)
    if not h:
        return {"error": "handle required"}
    meta = _PLATFORMS.get(platform)
    if not meta:
        return {"error": f"unsupported platform '{platform}'"}
    a = get_agent(agent_id)
    if not a:
        return {"error": "no active agent"}
    # Canonical corpus key so watched-account posts tag into the SAME partition
    # collect() writes to (typed→canonical drift would otherwise split them).
    topic = agent_corpus_topic(a)

    rows: list[dict] = []
    try:
        if platform == "x":
            # Full user timeline (UserTweets, with from: fallback) — not just search.
            from ..sources.x_twitter import fetch_x_user
            rows = fetch_x_user(h, limit=limit) or []
    except Exception as e:
        return {"handle": h, "platform": platform, "error": f"fetch failed: {e}"}

    # Surface the backend's own error reason before filtering it out.
    backend_err = next((r.get("_error") for r in rows if isinstance(r, dict) and r.get("_error")), None)
    rows = [r for r in rows if isinstance(r, dict) and "_error" not in r and r.get("id")]
    if not rows:
        reason = backend_err or f"connect X (Connections) and ensure the handle is correct"
        return {"handle": h, "platform": platform, "fetched": 0,
                "message": f"No posts returned for @{h} — {reason}"}

    tagged = 0
    try:
        from ..core.db import upsert_posts
        from ..research.collect import _tag_posts
        upsert_posts(rows)
        tagged = _tag_posts(topic, [r["id"] for r in rows if r.get("id")],
                            source=f"watch:{platform}:@{h}")
    except Exception:
        pass

    db = _ensure(init_reply_schema())
    aid = a["id"]
    try:
        db["reply_accounts"].upsert(
            {"agent_id": aid, "platform": platform, "handle": h, "tracked": 1,
             "last_fetched_at": int(time.time()),
             "posts_count": len(rows)},
            pk=("agent_id", "platform", "handle"), alter=True)
    except Exception:
        pass

    learned = None
    if learn:
        try:
            from .learn import learn_for_agent
            learned = learn_for_agent(aid)
        except Exception:
            learned = None

    return {
        "handle": h, "platform": platform, "fetched": len(rows), "tagged": tagged,
        "sample": [{"title": (r.get("title") or "")[:120],
                    "text": (r.get("selftext") or r.get("body") or r.get("title") or "")[:500],
                    "url": r.get("url")}
                   for r in rows[:5]],
        "learned": learned,
        "message": f"Pulled {len(rows)} post(s) from @{h} into your corpus"
                   + (" and learned from them." if learn else " — open Library or Compose to use them."),
    }


def fetch_tracked(*, platform: str | None = None, limit: int = 25,
                  agent_id: str | None = None, learn: bool = False) -> dict:
    """Fetch every tracked account for the agent. Returns per-account results."""
    accts = list_accounts(platform=platform, agent_id=agent_id)["accounts"]
    out = []
    total = 0
    for a in accts:
        r = fetch_account(a["handle"], platform=a["platform"], limit=limit,
                          agent_id=agent_id, learn=False)
        total += int(r.get("fetched", 0) or 0)
        out.append(r)
    learned = None
    if learn and total:
        try:
            from .learn import learn_for_agent
            learned = learn_for_agent(agent_id)
        except Exception:
            learned = None
    return {"accounts": len(accts), "fetched": total, "results": out, "learned": learned}
