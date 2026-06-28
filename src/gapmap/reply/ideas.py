"""Idea synthesis — combine the agent's knowledge (memories + beliefs, linked
across sources) into suggested articles/posts. Brain-like: it fuses threads,
names what it combined, and scores fit to the goal. Fail-soft — never raises."""
from __future__ import annotations

import hashlib
import json
import time

from ..analyze.providers.base import get_provider
from .agent import get_agent, list_linked_personas
from .schema import init_reply_schema
from .util import loads_json

_SYS = "You turn research threads into ONE content idea as STRICT JSON. Output ONLY JSON."


def list_ideas(agent_id: str | None = None, status: str | None = None) -> list[dict]:
    db = init_reply_schema()
    a = get_agent(agent_id)
    if not a:
        return []
    where, args = "agent_id = ?", [a["id"]]
    if status:
        where += " AND status = ?"
        args.append(status)
    return list(db["reply_ideas"].rows_where(
        where, args, order_by="goal_fit desc, created_at desc"))


def set_idea_status(idea_id: str, status: str) -> dict:
    db = init_reply_schema()
    try:
        db["reply_ideas"].update(idea_id, {"status": status})
        return {"ok": True, "id": idea_id, "status": status}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _clusters_for_agent(agent_id: str) -> list[list[dict]]:
    """Memory clusters across the agent's personas (reuses conclude's union-find
    over relates_to/builds_on edges)."""
    from ..persona.conclude import _cluster_memories, _fetch_memories
    out: list[list[dict]] = []
    for ln in list_linked_personas(agent_id):
        pid = int(ln["persona_id"])
        try:
            for grp in _cluster_memories(pid):
                mems = _fetch_memories(grp)
                if len(mems) >= 2:
                    out.append(mems)
        except Exception:
            continue
    return out


def suggest_ideas(agent_id: str | None = None, n: int = 5,
                  provider: str | None = None) -> dict:
    """Cluster linked knowledge and synthesize up to `n` content ideas, each
    fusing multiple threads and tagged with its source mix + goal fit."""
    db = init_reply_schema()
    a = get_agent(agent_id)
    if not a:
        return {"ok": False, "skipped": True, "reason": "no such agent", "ideas": []}
    goal = (a.get("goal") or a.get("objective") or "").strip()
    clusters = _clusters_for_agent(a["id"])
    if not clusters:
        return {"ok": True, "ideas": [], "reason": "not enough linked knowledge yet"}

    made: list[dict] = []
    now = int(time.time())
    for grp in clusters[:n]:
        threads = "\n".join(f"- {(m.get('lesson') or '')[:180]}" for m in grp[:6])
        prompt = (
            f"GOAL: {goal or '(promote the product helpfully)'}\n"
            f"Product: {a.get('product') or a.get('brand') or '-'}\n\n"
            f"Knowledge threads (combine them into ONE idea):\n{threads}\n\n"
            "Return ONLY JSON: "
            '{"title":"","thesis":"one-paragraph angle that fuses the threads",'
            '"kind":"article|post|thread","goal_fit":0.0,'
            '"source_mix":"data-source|conclusion|mixed"}'
        )
        try:
            data = loads_json(get_provider(provider).complete(
                prompt, system=_SYS, max_tokens=400, temperature=0.5))
        except Exception as e:
            if "No LLM provider" in str(e):
                return {"ok": False, "skipped": True, "reason": "no LLM configured",
                        "ideas": made}
            continue
        if not isinstance(data, dict) or not data.get("title"):
            continue
        iid = hashlib.sha1(f"{a['id']}|{data['title']}|{now}".encode()).hexdigest()[:16]
        rec = {
            "id": iid, "agent_id": a["id"], "title": str(data["title"])[:200],
            "thesis": str(data.get("thesis", ""))[:1200],
            "kind": (data.get("kind") or "article")[:20],
            "combines_json": json.dumps([m.get("id") for m in grp]),
            "source_mix": (data.get("source_mix") or "mixed")[:20],
            "goal_fit": float(data.get("goal_fit", 0) or 0),
            "status": "suggested", "created_at": now,
        }
        db["reply_ideas"].upsert(rec, pk="id")
        made.append(rec)
    return {"ok": True, "ideas": made}


def draft_from_idea(idea_id: str, kind: str | None = None,
                    platform: str | None = None, provider: str | None = None) -> dict:
    """Turn a suggested idea into a real draft via the content generator
    (written from the goal + playbook + the fused thesis)."""
    db = init_reply_schema()
    try:
        idea = dict(db["reply_ideas"].get(idea_id))
    except Exception as e:
        return {"ok": False, "error": f"no idea '{idea_id}': {e}"}
    from .content import generate_content
    angle = f"{idea.get('title', '')} — {idea.get('thesis', '')}"
    res = generate_content(kind or idea.get("kind") or "article",
                           agent_id=idea["agent_id"], platform=platform,
                           angle=angle, provider=provider)
    if isinstance(res, dict) and not res.get("error"):
        try:
            db["reply_ideas"].update(idea_id, {"status": "used"})
        except Exception:
            pass
    return res
