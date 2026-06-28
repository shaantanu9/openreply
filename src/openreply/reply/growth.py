"""Growth plan — turn an agent's PURPOSE into an actionable strategy.

The agent now knows *why* it exists (`goal`) and *what it offers* (`product`).
This module asks the BYOK LLM to synthesize a concrete, ethical Reddit-first
growth plan from that purpose plus the agent's niche, audience, keywords, and
tracked subreddits: target communities, messaging angles, a cadence, KPIs, and
first steps. The plan is persisted per agent (`reply_growth`) so it survives and
can be regenerated as the agent learns.
"""
from __future__ import annotations

import json
import time

from ..analyze.providers.base import get_provider
from .agent import active_id, get_active_agent, get_agent
from .schema import init_reply_schema
from .util import loads_json

_SYS = (
    "You are a growth strategist for Reddit-first, community-led marketing. You "
    "design plans that grow a product by being genuinely helpful — never spammy "
    "or manipulative. Output ONLY JSON."
)


def _ensure(db):
    if "reply_growth" not in set(db.table_names()):
        db["reply_growth"].create(
            {"agent_id": str, "plan_json": str, "created_at": int}, pk="agent_id")
    return db


def _tracked(agent_id: str | None) -> list[str]:
    try:
        from .subreddit import list_tracked
        return [s.get("sub") for s in (list_tracked(agent_id).get("subreddits") or [])
                if s.get("sub")][:12]
    except Exception:
        return []


def generate_growth_plan(agent_id: str | None = None, provider: str | None = None) -> dict:
    """Generate + persist a growth plan for the agent from its goal/product/niche."""
    a = get_agent(agent_id) if agent_id else get_active_agent()
    if not a:
        return {"error": "no active agent — create one first"}
    subs = _tracked(a.get("id"))
    prompt = (
        f"Brand/agent: {a.get('name')}\n"
        f"Product (what they offer): {a.get('product') or a.get('niche') or '—'}\n"
        f"Growth goal: {a.get('goal') or '—'}\n"
        f"Niche: {a.get('niche') or '—'}\n"
        f"Audience: {a.get('audience') or '—'}\n"
        f"Keywords: {', '.join(a.get('keywords') or [])}\n"
        f"Already-tracked subreddits: {', '.join(subs) or 'none yet'}\n\n"
        "Design a concrete, ethical Reddit-first growth plan to reach the goal by "
        "being genuinely helpful (no spam, no fake accounts). Prefer communities "
        "that fit the niche. Return ONLY JSON:\n"
        "{\n"
        '  "summary": "2-3 sentence strategy",\n'
        '  "target_communities": [{"sub": "name (no r/)", "why": "one line"}],\n'
        '  "angles": ["a value-first angle the brand can lead with", "..."],\n'
        '  "cadence": "how often to engage + replies/posts per week",\n'
        '  "kpis": ["metric to track", "..."],\n'
        '  "first_steps": ["concrete action 1", "action 2", "action 3"]\n'
        "}"
    )
    try:
        raw = get_provider(provider).complete(prompt, system=_SYS, max_tokens=900, temperature=0.4)
        plan = loads_json(raw)
    except Exception as e:
        return {"error": f"growth plan failed (is an LLM provider configured?): {e}"}
    if not plan:
        return {"error": "could not parse a plan (the model returned no JSON)"}
    db = _ensure(init_reply_schema())
    now = int(time.time())
    db["reply_growth"].upsert(
        {"agent_id": a["id"], "plan_json": json.dumps(plan, ensure_ascii=False), "created_at": now},
        pk="agent_id",
    )
    return {"agent_id": a["id"], "plan": plan, "created_at": now}


def get_growth_plan(agent_id: str | None = None) -> dict:
    """The last-saved growth plan for the agent (or `{plan: None}`)."""
    db = _ensure(init_reply_schema())
    aid = agent_id or active_id() or "default"
    try:
        row = dict(db["reply_growth"].get(aid))
        return {"agent_id": aid, "plan": json.loads(row.get("plan_json") or "{}"),
                "created_at": row.get("created_at")}
    except Exception:
        return {"agent_id": aid, "plan": None}
