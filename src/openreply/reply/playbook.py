"""Goal Playbook — the agent's self-evolving promotion strategy.

Distills the agent's goal + its memory (semantic retrieval over the persona
ChromaDB collections), beliefs (conclusions), and feedback (engaged/dismissed +
human edit-diffs) into a structured, versioned strategy that generation writes
from. Fail-soft: never raises; skips with a reason when no goal / no LLM.
"""
from __future__ import annotations

import hashlib
import json
import time

from ..analyze.providers.base import get_provider
from .agent import get_agent, list_linked_personas
from .schema import init_reply_schema
from .util import loads_json

_SYS = "You distill a brand's outreach strategy into STRICT JSON. Output ONLY JSON."


def current_playbook(agent_id: str | None = None) -> dict | None:
    """Latest playbook version for the agent (parsed), or None."""
    db = init_reply_schema()
    a = get_agent(agent_id)
    if not a:
        return None
    rows = list(db["reply_playbook"].rows_where(
        "agent_id = ?", [a["id"]], order_by="version desc", limit=1))
    if not rows:
        return None
    r = rows[0]
    try:
        pb = json.loads(r.get("playbook_json") or "{}")
    except Exception:
        pb = {}
    return {"version": r["version"], "playbook": pb,
            "summary": r.get("summary", ""), "created_at": r.get("created_at")}


def playbook_block(agent_id: str | None = None) -> str:
    """Compact strategy block for generation prompts (empty if no playbook)."""
    cur = current_playbook(agent_id)
    if not cur or not cur.get("playbook"):
        return ""
    pb = cur["playbook"]
    lines = [f"STRATEGY PLAYBOOK v{cur['version']} — write in line with this:"]
    for a in (pb.get("winning_angles") or [])[:3]:
        if isinstance(a, dict):
            lines.append(f"- angle: {a.get('angle', '')} ({a.get('why', '')})")
        else:
            lines.append(f"- angle: {a}")
    avoid = pb.get("avoid") or []
    if avoid:
        lines.append("AVOID: " + "; ".join(str(x) for x in avoid[:4]))
    return "\n".join(lines) + "\n"


def _gather_memories(agent_id: str, goal: str, k: int = 8) -> list[dict]:
    """Goal-relevant memories across the agent's linked personas via the palace
    embeddings (semantic), falling back to keyword retrieval. `retrieve` returns
    a (rows, mode) tuple."""
    from ..persona.retrieve import retrieve
    out: list[dict] = []
    for ln in list_linked_personas(agent_id):
        try:
            rows, _mode = retrieve(int(ln["persona_id"]), goal or "", k)
            out += rows or []
        except Exception:
            pass
    return out


def _gather_beliefs(agent_id: str) -> list[dict]:
    from ..persona.conclude import list_conclusions
    out: list[dict] = []
    for ln in list_linked_personas(agent_id):
        try:
            out += list_conclusions(int(ln["persona_id"]), limit=20) or []
        except Exception:
            pass
    return out


def _edit_diffs(db, agent_id: str, limit: int = 8) -> list[dict]:
    """Pairs of (generated, final-edited) draft text — 'what the human changed'."""
    rows = list(db["reply_drafts"].rows_where(
        "brand_id = ?", [agent_id], order_by="created_at desc", limit=200))
    by_opp: dict[str, list[dict]] = {}
    for r in rows:
        by_opp.setdefault(r["opportunity_id"], []).append(r)
    diffs: list[dict] = []
    for _opp, drs in by_opp.items():
        gen = next((d for d in drs if d.get("source") == "generated"), None)
        edited = next((d for d in drs if d.get("source") == "edited"), None)
        if gen and edited and gen.get("text") != edited.get("text"):
            diffs.append({"before": (gen["text"] or "")[:500],
                          "after": (edited["text"] or "")[:500]})
        if len(diffs) >= limit:
            break
    return diffs


def _llm_distill(goal_block: str, mem_txt: str, belief_txt: str,
                 fb_txt: str, diff_txt: str, provider: str | None) -> dict:
    prompt = (
        f"{goal_block}\n"
        f"What the agent has learned (memories):\n{mem_txt or '(none yet)'}\n\n"
        f"Its beliefs (conclusions):\n{belief_txt or '(none yet)'}\n\n"
        f"Feedback so far:\n{fb_txt}\n\n"
        f"How the human edited recent drafts (before -> after):\n{diff_txt or '(none)'}\n\n"
        "Distill a promotion playbook that advances the GOAL while staying genuinely "
        "helpful and non-spammy. Return ONLY this JSON:\n"
        '{"winning_angles":[{"angle":"","why":"","for":""}],'
        '"phrasings":[""],"avoid":[""],'
        '"per_platform":{"reddit":""},"next_experiments":[""]}'
    )
    raw = get_provider(provider).complete(prompt, system=_SYS, max_tokens=900, temperature=0.3)
    data = loads_json(raw)
    if not isinstance(data, dict) or not data:
        raise ValueError("empty playbook")
    return data


def evolve_playbook(agent_id: str | None = None, provider: str | None = None,
                    reason: str = "manual") -> dict:
    """Re-distill the agent's Goal Playbook from memory + beliefs + feedback.
    Persists a new version. Fail-soft."""
    db = init_reply_schema()
    a = get_agent(agent_id)
    if not a:
        return {"ok": False, "skipped": True, "reason": "no such agent"}
    goal = (a.get("goal") or "").strip()
    if not goal and not (a.get("objective") or "").strip():
        return {"ok": False, "skipped": True,
                "reason": "no goal set — add an objective on the agent"}

    goal_block = (
        f"GOAL\nObjective: {a.get('objective') or goal}\n"
        f"Audience: {a.get('audience') or '-'}\n"
        f"Win signal: {a.get('win_signal') or '-'}\n"
        f"Guardrails: {a.get('guardrails') or 'be honest; disclose; never spam'}\n"
        f"Product: {a.get('product') or a.get('brand') or a.get('niche') or '-'}"
    )
    mems = _gather_memories(a["id"], goal)
    beliefs = _gather_beliefs(a["id"])
    mem_txt = "\n".join(f"- {(m.get('lesson') or '')[:200]}" for m in mems[:12])
    belief_txt = "\n".join(f"- {(b.get('statement') or '')[:200]}" for b in beliefs[:10])
    try:
        from .feedback import feedback_counts
        fb = feedback_counts(a["id"])
    except Exception:
        fb = {}
    fb_txt = f"engaged={fb.get('engaged', 0)} dismissed={fb.get('dismissed', 0)}"
    diffs = _edit_diffs(db, a["id"])
    diff_txt = "\n".join(f"BEFORE: {d['before']}\nAFTER: {d['after']}" for d in diffs)

    try:
        pb = _llm_distill(goal_block, mem_txt, belief_txt, fb_txt, diff_txt, provider)
    except Exception as e:
        msg = str(e)
        if "No LLM provider" in msg:
            return {"ok": False, "skipped": True, "reason": "no LLM configured",
                    "error_class": "llm_key"}
        return {"ok": False, "skipped": True, "reason": f"distill failed: {msg[:160]}"}

    prev = current_playbook(a["id"])
    version = (prev["version"] + 1) if prev else 1
    now = int(time.time())
    pid = hashlib.sha1(f"{a['id']}|{version}|{now}".encode()).hexdigest()[:16]
    summary = (f"v{version} from {len(mems)} memories, {len(beliefs)} beliefs, "
               f"{len(diffs)} edit(s) · trigger={reason}")
    db["reply_playbook"].upsert({
        "id": pid, "agent_id": a["id"], "version": version,
        "playbook_json": json.dumps(pb),
        "sources_json": json.dumps({"memories": len(mems), "beliefs": len(beliefs),
                                    "edit_diffs": len(diffs), "feedback": fb,
                                    "reason": reason}),
        "summary": summary, "created_at": now,
    }, pk="id")
    try:
        db["agents"].update(a["id"], {"last_evolve_at": now, "feedback_since_evolve": 0})
    except Exception:
        pass
    return {"ok": True, "version": version, "summary": summary,
            "memories": len(mems), "beliefs": len(beliefs)}
