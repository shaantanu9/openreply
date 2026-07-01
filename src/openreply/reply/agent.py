"""Agents (personas) — the central entity of OpenReply.

An **Agent** = a brand/niche identity + voice + a knowledge scope (a `topic` corpus
that auto-refreshes) + the platforms it watches and posts on. This supersedes the
old single "topic" and single "brand": the reply engine reads the *active* agent via
`brand.py`, so opportunities and drafts are automatically agent-scoped.

Tables: `agents` (one row per persona) and `reply_state` (kv; holds the active agent
id). Knowledge (`posts`/`topic_posts`/`graph_*`/`findings`) is shared and scoped by
`agents.topic`.
"""
from __future__ import annotations

import hashlib
import json
import time

from .schema import init_reply_schema

_HYDRATE = ("keywords", "platforms", "accounts")


def agent_corpus_topic(agent: dict, db=None) -> str:
    """Topic string the agent's posts are actually tagged under.

    Collection tags every post via `research.collect._tag_posts`, which runs the
    topic through `resolve_topic` (LLM canonicalization + alias index) BEFORE
    writing the `topic_posts` row. The agent record, however, stores the ORIGINAL
    typed topic. So an agent whose topic canonicalized (e.g. "AI-powered software
    development and engineering services" → "AI-powered software development
    services") has all its posts under the canonical, and any read that does
    `WHERE tp.topic = agent.topic` with the RAW topic matches zero rows — which
    silently empties the Daily Update, Library, chat knowledge, content sourcing,
    post counts, and the brain build.

    Resolve to the canonical. When a `db` is given, fall back to the raw topic if
    the resolved one has no posts but the raw one does (defensive against any
    historical rows tagged under the original string).
    """
    raw = (agent.get("topic") or agent.get("name") or "").strip()
    if not raw:
        return raw
    try:
        from ..research.topic_resolver import resolve_topic
        resolved = resolve_topic(raw, register=False) or raw
    except Exception:
        return raw
    if resolved == raw or db is None:
        return resolved

    def _count(t: str) -> int:
        try:
            return list(db.query(
                "SELECT COUNT(*) c FROM topic_posts WHERE topic = ?", [t]))[0]["c"]
        except Exception:
            return 0

    if _count(resolved) == 0 and _count(raw) > 0:
        return raw
    return resolved


def _ensure(db):
    names = set(db.table_names())
    if "agents" not in names:
        db["agents"].create(
            {
                "id": str, "name": str, "brand": str, "niche": str,
                "persona": str, "tone": str, "audience": str, "topic": str,
                "website": str, "goal": str, "product": str,
                # Structured goal (the thing the self-evolving engine optimizes toward).
                "objective": str, "win_signal": str, "guardrails": str,
                # Self-evolution bookkeeping.
                "last_evolve_at": int, "feedback_since_evolve": int,
                "keywords_json": str, "platforms_json": str, "accounts_json": str,
                "refresh_cadence": str, "last_refresh_at": int,
                "last_learn_at": int,
                "created_at": int, "updated_at": int,
            },
            pk="id",
        )
    else:
        # Migration: stamp of the last autonomous-learning pass (ingest+synthesize).
        cols = {c.name for c in db["agents"].columns}
        if "last_learn_at" not in cols:
            try:
                db["agents"].add_column("last_learn_at", int)
            except Exception:
                pass
        # Migration: brand website/domain — used to detect citations in AI answers (GEO).
        if "website" not in cols:
            try:
                db["agents"].add_column("website", str)
            except Exception:
                pass
        # Migration: purpose — `goal` (WHY this agent exists / what to grow) and
        # `product` (what you offer). Both feed the draft prompt + growth plan so
        # the agent reasons from its purpose, not just generic helpfulness.
        for _pc in ("goal", "product"):
            if _pc not in cols:
                try:
                    db["agents"].add_column(_pc, str)
                except Exception:
                    pass
        # Migration: structured goal (objective/win_signal/guardrails — audience
        # already exists) + self-evolution bookkeeping (last_evolve_at epoch,
        # feedback_since_evolve counter). Drive the Goal Playbook engine.
        for _gc, _typ in (("objective", str), ("win_signal", str), ("guardrails", str),
                          ("last_evolve_at", int), ("feedback_since_evolve", int)):
            if _gc not in cols:
                try:
                    db["agents"].add_column(_gc, _typ)
                except Exception:
                    pass
    if "reply_state" not in names:
        db["reply_state"].create({"key": str, "value": str}, pk="key")
    if "agent_personas" not in names:
        # Bridges a product/brand Agent to one or more learning Personas, so the
        # reply blend can draw on each persona's own knowledge base + graph.
        # `weight` controls proportional slot allocation across linked personas.
        db["agent_personas"].create(
            {
                "agent_id": str, "persona_id": int,
                "weight": float, "created_at": int,
            },
            pk=("agent_id", "persona_id"),
        )
        db["agent_personas"].create_index(["agent_id"])
    return db


def _slug(s: str) -> str:
    out = "".join(c if c.isalnum() else "-" for c in (s or "").lower())
    return out.strip("-")[:60] or "agent"


def _hydrate(row: dict) -> dict:
    row = dict(row)
    row["keywords"] = json.loads(row.get("keywords_json") or "[]")
    row["platforms"] = json.loads(row.get("platforms_json") or "[]")
    row["accounts"] = json.loads(row.get("accounts_json") or "[]")
    # Compose a goal string from the structured fields when no free-text goal is
    # set, so generation (which reads agent["goal"]) always has a target.
    if not (row.get("goal") or "").strip():
        parts = []
        if row.get("objective"):  parts.append(row["objective"])
        if row.get("audience"):   parts.append(f"for {row['audience']}")
        if row.get("win_signal"): parts.append(f"win = {row['win_signal']}")
        if parts:
            row["goal"] = " · ".join(parts)
    return row


def _row(db, aid: str):
    try:
        return db["agents"].get(aid)
    except Exception:
        return None


# ---- active-agent pointer ------------------------------------------------

def active_id() -> str | None:
    db = _ensure(init_reply_schema())
    try:
        return dict(db["reply_state"].get("active_agent"))["value"]
    except Exception:
        # default to the only/first agent if unset
        rows = list(db["agents"].rows_where(order_by="created_at asc", limit=1))
        return rows[0]["id"] if rows else None


def set_active(aid: str) -> None:
    db = _ensure(init_reply_schema())
    db["reply_state"].upsert({"key": "active_agent", "value": aid}, pk="key")


# ---- CRUD ----------------------------------------------------------------

def create_agent(
    *,
    name: str,
    brand: str = "",
    niche: str = "",
    website: str = "",
    goal: str = "",
    product: str = "",
    persona: str = "",
    tone: str = "helpful, concise, non-salesy",
    audience: str = "",
    keywords: list[str] | None = None,
    platforms: list[str] | None = None,
    accounts: list[str] | None = None,
    refresh_cadence: str = "off",
    make_active: bool = True,
) -> dict:
    db = _ensure(init_reply_schema())
    aid = _slug(name)
    if _row(db, aid):
        aid = f"{aid}-{hashlib.sha1(f'{name}{time.time()}'.encode()).hexdigest()[:6]}"
    now = int(time.time())
    # The agent's knowledge corpus is keyed by `topic`. Niche is the natural
    # corpus key — multiple agents for the same niche should share one brain.
    # Fall back to brand/name only when no niche is supplied.
    topic = (niche or brand or name or aid).strip()
    rec = {
        "id": aid, "name": name, "brand": brand or name, "niche": niche,
        "website": website, "goal": goal, "product": product,
        "persona": persona, "tone": tone, "audience": audience, "topic": topic,
        "keywords_json": json.dumps(keywords or []),
        "platforms_json": json.dumps(platforms or ["reddit_free", "hn", "lemmy", "mastodon", "devto", "stackoverflow", "producthunt"]),
        "accounts_json": json.dumps(accounts or []),
        "refresh_cadence": refresh_cadence, "last_refresh_at": 0,
        "created_at": now, "updated_at": now,
    }
    db["agents"].insert(rec, pk="id")
    if make_active:
        set_active(aid)
    return get_agent(aid)


def update_agent(aid: str, **fields) -> dict | None:
    db = _ensure(init_reply_schema())
    if not _row(db, aid):
        return None
    patch: dict = {}
    for k in ("name", "brand", "niche", "website", "goal", "product", "persona",
              "tone", "audience", "refresh_cadence",
              "objective", "win_signal", "guardrails"):
        if k in fields and fields[k] is not None:
            patch[k] = fields[k]
    for k in ("keywords", "platforms", "accounts"):
        if k in fields and fields[k] is not None:
            patch[f"{k}_json"] = json.dumps(fields[k])
    for k in ("last_refresh_at", "last_evolve_at", "feedback_since_evolve"):
        if k in fields and fields[k] is not None:
            patch[k] = fields[k]
    patch["updated_at"] = int(time.time())
    db["agents"].update(aid, patch)
    return get_agent(aid)


def get_agent(aid: str | None = None) -> dict | None:
    db = _ensure(init_reply_schema())
    aid = aid or active_id()
    if not aid:
        return None
    row = _row(db, aid)
    return _hydrate(row) if row else None


def get_active_agent() -> dict | None:
    return get_agent(None)


def list_agents() -> list[dict]:
    db = _ensure(init_reply_schema())
    act = active_id()

    def _count(sql, args):
        try:
            return db.execute(sql, args).fetchone()[0]
        except Exception:
            return 0

    out = []
    for r in db["agents"].rows_where(order_by="created_at asc"):
        a = _hydrate(r)
        a["active"] = a["id"] == act
        # Per-agent stats for the Agents card (posts collected / brain nodes /
        # open opportunities). Topic-scoped like knowledge_summary; opps are
        # brand-scoped (brand_id == agent id).
        topic = agent_corpus_topic(a, db)
        a["posts"] = _count("SELECT COUNT(*) FROM topic_posts WHERE topic=?", [topic])
        a["graph_nodes"] = _count("SELECT COUNT(*) FROM graph_nodes WHERE topic=?", [topic])
        a["opps"] = _count(
            "SELECT COUNT(*) FROM reply_opportunities WHERE brand_id=? AND status='new'",
            [a["id"]])
        out.append(a)
    return out


def delete_agent(aid: str) -> bool:
    db = _ensure(init_reply_schema())
    if not _row(db, aid):
        return False
    db["agents"].delete(aid)
    return True


# ---- persona links -------------------------------------------------------

def link_persona(agent_id: str, persona_id: int, *, weight: float = 1.0) -> dict:
    """Link a learning Persona to an Agent (idempotent upsert). The agent's
    replies will then blend that persona's memories + graph + conclusions."""
    db = _ensure(init_reply_schema())
    if not _row(db, agent_id):
        return {"error": f"no agent '{agent_id}'"}
    try:
        from ..persona.store import get_persona

        if not get_persona(int(persona_id)):
            return {"error": f"no persona id={persona_id}"}
    except Exception:
        pass
    db["agent_personas"].upsert(
        {
            "agent_id": agent_id, "persona_id": int(persona_id),
            "weight": float(weight), "created_at": int(time.time()),
        },
        pk=("agent_id", "persona_id"),
    )
    return {"linked": True, "agent_id": agent_id, "persona_id": int(persona_id), "weight": float(weight)}


def unlink_persona(agent_id: str, persona_id: int) -> dict:
    db = _ensure(init_reply_schema())
    try:
        db["agent_personas"].delete((agent_id, int(persona_id)))
        return {"unlinked": True, "agent_id": agent_id, "persona_id": int(persona_id)}
    except Exception:
        return {"unlinked": False, "agent_id": agent_id, "persona_id": int(persona_id)}


def list_linked_personas(agent_id: str) -> list[dict]:
    """Return [{persona_id, weight, name, lens}] for an agent's linked personas.

    Hydrates name+lens from the personas table so the blend can tag knowledge
    with its lens; gracefully drops links whose persona was deleted.
    """
    db = _ensure(init_reply_schema())
    try:
        rows = list(db["agent_personas"].rows_where("agent_id = ?", [agent_id], order_by="created_at asc"))
    except Exception:
        return []
    if not rows:
        return []
    try:
        from ..persona.store import get_persona
    except Exception:
        get_persona = None  # type: ignore
    out: list[dict] = []
    for r in rows:
        pid = int(r["persona_id"])
        name, lens = f"persona#{pid}", ""
        if get_persona:
            p = get_persona(pid)
            if not p:
                continue  # persona deleted — skip the dangling link
            name, lens = p.get("name") or name, p.get("lens") or ""
        out.append({"persona_id": pid, "weight": float(r.get("weight") or 1.0), "name": name, "lens": lens})
    return out


# ---- knowledge -----------------------------------------------------------

def knowledge_summary(aid: str | None = None) -> dict:
    a = get_agent(aid)
    if not a:
        return {"error": "no agent"}
    db = init_reply_schema()
    topic = agent_corpus_topic(a, db)

    def _count(sql, args):
        try:
            return db.execute(sql, args).fetchone()[0]
        except Exception:
            return 0

    # The legacy `findings` table is no longer populated by the current
    # graph/LLM pipeline. Surface meaningful insight counts from the semantic
    # concept nodes (painpoints / wishes / workarounds / products) instead.
    concept_kinds = ("painpoint", "feature_wish", "workaround", "product")
    ph = ",".join(["?"] * len(concept_kinds))
    concept_count = _count(
        f"SELECT COUNT(*) FROM graph_nodes WHERE topic=? AND kind IN ({ph})",
        [topic, *concept_kinds],
    )
    legacy_findings = _count("SELECT COUNT(*) FROM findings WHERE topic=?", [topic])
    return {
        "agent": a["name"], "topic": topic,
        "posts": _count("SELECT COUNT(*) FROM topic_posts WHERE topic=?", [topic]),
        "graph_nodes": _count("SELECT COUNT(*) FROM graph_nodes WHERE topic=?", [topic]),
        "findings": concept_count or legacy_findings,
        "last_refresh_at": a["last_refresh_at"],
    }


def refresh_agent(aid: str | None = None, light: bool = True, progress=None,
                  learn: bool = True) -> dict:
    """Re-fetch the latest niche knowledge for the agent (reuses research.collect),
    then — by default — run a learning pass so the freshly fetched posts become
    memories + beliefs (the autonomous loop's "after every fetch" trigger)."""
    a = get_agent(aid)
    if not a:
        return {"error": "no such agent"}
    # Audience-topic keywords (LLM-expanded from the agent's identity), never the
    # bare agent name — surfaced for visibility; collect itself canonicalizes the
    # topic internally.
    try:
        from .keywords import agent_search_keywords
        keywords = agent_search_keywords(a) or a["keywords"] or [a["topic"]]
    except Exception:
        keywords = a["keywords"] or [a["topic"]]
    try:
        from ..research.collect import collect
        from .library import corpus_sources

        res = collect(
            topic=a["topic"],
            subs=None,
            sources=corpus_sources(a),
            aggressive=not light,
            skip_extraction=True,
            progress=progress,
        )
        update_agent(a["id"], last_refresh_at=int(time.time()))
        out = {
            "agent": a["name"], "topic": a["topic"],
            "posts_fetched": getattr(res, "posts_fetched", None),
            "by_source": getattr(res, "by_source", {}),
            "keywords": keywords,
        }
        # Autonomous learning: distill the new posts into memories + beliefs.
        # Best-effort — a learning hiccup must never fail the refresh.
        if learn:
            try:
                from .learn import learn_for_agent
                out["learning"] = learn_for_agent(a["id"], progress=progress)
            except Exception as e:
                out["learning"] = {"error": f"learn skipped: {e}"}
        return out
    except Exception as e:
        return {"agent": a["name"], "error": f"refresh failed: {e}"}
