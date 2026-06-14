"""FSD Fleet — flow orchestration (Phase 4).

The agentflow that ties the Fleet together end to end:

    decision-gate → route plan → clarify-check → ground → debate → synthesize

Each stage reuses an existing capability (no new LLM logic):
  - clarify-check : research/brief.get_brief
  - ground        : persona/ingest.ingest_all_personas (teach agents the topic)
  - synthesize    : research/insights (cached report or a fresh synthesis)
  - debate        : research/debate_run.run_topic_debate
  - audit         : research/debate_run.get_debate_audit (read-only)

A `decision_gate` classifies the work as simple vs complex (WhyBuddy's gate);
`plan_routes` offers quick/standard/deep variants with risk + cost estimates for
a confirmation gate; `run_fleet_flow` executes a route's stages, recording a
per-stage timeline to `fleet_runs` so the UI can render the flow + replay it.

Public API:
  decision_gate(topic)            -> {mode, reasons, signals}
  plan_routes(topic)              -> {routes: [...], recommended}
  run_fleet_flow(topic, route)    -> {ok, route, mode, stages, cost_tokens, ...}
  get_fleet_status(topic)         -> latest fleet_runs row (parsed)
"""
from __future__ import annotations

import uuid
from typing import Any

from ..core import db

# Route definitions — ordered stage lists. clarify/ground/synthesize/debate/audit
# map 1:1 to the stage runners in _STAGE_RUNNERS below.
ROUTES: dict[str, dict[str, Any]] = {
    "quick": {
        "label": "Quick scan",
        "stages": ["clarify_check", "synthesize"],
        "risk": "low",
        "blurb": "Synthesize findings only. Cheapest, no debate.",
    },
    "standard": {
        "label": "Standard",
        "stages": ["clarify_check", "synthesize", "debate", "audit"],
        "risk": "medium",
        "blurb": "Synthesize, then run the 5-persona debate and tier the findings.",
    },
    "deep": {
        "label": "Deep",
        "stages": ["clarify_check", "ground", "synthesize", "debate", "audit"],
        "risk": "high",
        "blurb": "Teach the agents this topic first, then synthesize + debate + audit.",
    },
}

# Rough per-stage token estimates for the cost/risk preview (real cost is
# recorded after the run from the debate's measured estimate).
_STAGE_EST = {"clarify_check": 0, "ground": 6000, "synthesize": 9000,
              "debate": 8000, "audit": 0}


# ── Signals + decision gate ───────────────────────────────────────────────────

def _signals(topic: str) -> dict[str, Any]:
    """Cheap, LLM-free signals that drive the decision gate + route preview."""
    sig = {"corpus_size": 0, "source_count": 0, "findings": 0,
           "has_brief": False, "agents_learned": 0}
    try:
        d = db.get_db()
        if "topic_posts" in d.table_names():
            r = list(d.query(
                "SELECT COUNT(*) c, COUNT(DISTINCT coalesce(p.source_type,'reddit')) s "
                "FROM topic_posts tp LEFT JOIN posts p ON p.id = tp.post_id WHERE tp.topic = ?",
                [topic]))
            if r:
                sig["corpus_size"] = int(r[0].get("c") or 0)
                sig["source_count"] = int(r[0].get("s") or 0)
        try:
            from .insights import load_insights
            rep = load_insights(topic)
            fnd = (rep or {}).get("findings") if isinstance(rep, dict) else None
            sig["findings"] = len(fnd) if isinstance(fnd, list) else 0
        except Exception:
            pass
        try:
            from .brief import get_brief
            b = get_brief(topic)
            sig["has_brief"] = any((b.get(k) or "").strip() for k in ("goal", "constraints", "success", "audience"))
        except Exception:
            pass
        if "persona_memories" in d.table_names():
            r = list(d.query(
                "SELECT COUNT(DISTINCT persona_id) c FROM persona_memories WHERE topic = ?", [topic]))
            sig["agents_learned"] = int(r[0].get("c") or 0) if r else 0
    except Exception:
        pass
    return sig


def decision_gate(topic: str) -> dict[str, Any]:
    """Classify the work as 'simple' (single-pass) vs 'complex' (full fleet).
    WhyBuddy's Decision Gate, in our domain: a complex topic has enough corpus
    and either multi-source breadth or many findings to be worth a debate."""
    sig = _signals(topic)
    reasons: list[str] = []
    complex_ = False
    if sig["corpus_size"] >= 40 and (sig["source_count"] > 1 or sig["findings"] >= 8):
        complex_ = True
        reasons.append(
            f"{sig['corpus_size']} posts across {sig['source_count']} source(s), "
            f"{sig['findings']} findings — worth a multi-persona debate.")
    else:
        reasons.append(
            f"{sig['corpus_size']} posts / {sig['findings']} findings — a single synthesis pass is enough.")
    if not sig["has_brief"]:
        reasons.append("No clarified brief set — results will be broader; add one to focus the fleet.")
    return {"ok": True, "topic": topic, "mode": "complex" if complex_ else "simple",
            "reasons": reasons, "signals": sig}


def plan_routes(topic: str) -> dict[str, Any]:
    """Offer the three route variants with risk + estimated cost; recommend one
    from the decision gate. This is the confirmation gate before spending."""
    gate = decision_gate(topic)
    recommended = "deep" if gate["mode"] == "complex" else "standard"
    routes = []
    for key, spec in ROUTES.items():
        est = sum(_STAGE_EST.get(s, 0) for s in spec["stages"])
        routes.append({
            "key": key, "label": spec["label"], "stages": spec["stages"],
            "risk": spec["risk"], "blurb": spec["blurb"],
            "est_cost_tokens": est, "recommended": key == recommended,
        })
    return {"ok": True, "topic": topic, "mode": gate["mode"],
            "recommended": recommended, "reasons": gate["reasons"],
            "signals": gate["signals"], "routes": routes}


# ── Stage runners ──────────────────────────────────────────────────────────────
# Each returns (status, detail, cost_tokens). status ∈ ok|reused|skipped|attention|error.

def _stage_clarify_check(topic: str, ctx: dict) -> tuple[str, str, int]:
    from .brief import get_brief
    b = get_brief(topic)
    if any((b.get(k) or "").strip() for k in ("goal", "constraints", "success", "audience")):
        return "ok", "Clarified brief present — fleet is scoped.", 0
    return "attention", "No clarified brief — running unscoped. Add one to focus results.", 0


def _stage_ground(topic: str, ctx: dict) -> tuple[str, str, int]:
    """Teach every active agent this topic's posts (memories cited to posts).
    ingest_all_personas is a generator — drain it so ingestion actually runs."""
    try:
        from ..persona.ingest import ingest_all_personas
        added = 0          # new memories ('memory' events)
        agents = 0         # personas that finished ('done' events)
        events = 0
        for ev in ingest_all_personas(topic=topic):
            events += 1
            if not isinstance(ev, dict):
                continue
            kind = ev.get("event")
            if kind == "memory":
                added += 1            # one 'memory' event per new lesson
            elif kind == "done":
                agents += 1           # one 'done' event per persona
        if events == 0:
            return "skipped", "No active agents to ground (create personas first).", 0
        return "ok", f"{agents} agent(s) grounded on this topic (+{added} memories).", 0
    except Exception as e:
        return "skipped", f"Grounding skipped ({str(e)[:80]}).", 0


def _stage_synthesize(topic: str, ctx: dict) -> tuple[str, str, int]:
    from .insights import load_insights, synthesize_insights
    rep = load_insights(topic)
    fnd = (rep or {}).get("findings") if isinstance(rep, dict) else None
    if isinstance(fnd, list) and fnd:
        ctx["findings"] = len(fnd)
        return "reused", f"Reused {len(fnd)} cached findings.", 0
    try:
        out = synthesize_insights(topic, persist=True)
        n = len((out or {}).get("findings") or []) if isinstance(out, dict) else 0
        ctx["findings"] = n
        if not n:
            return "attention", "Synthesis produced 0 findings (need more/stronger corpus or an LLM key).", 0
        return "ok", f"Synthesized {n} findings.", 0
    except Exception as e:
        return "error", f"Synthesis failed ({str(e)[:80]}).", 0


def _stage_debate(topic: str, ctx: dict) -> tuple[str, str, int]:
    from .debate_run import run_topic_debate
    res = run_topic_debate(topic, rounds=int(ctx.get("rounds") or 1))
    if not res.get("ok"):
        return ("attention" if res.get("reason") == "needs_synthesis" else "error",
                f"Debate not run ({res.get('reason') or res.get('error')}).", 0)
    c = res.get("counts") or {}
    cost = int(res.get("cost_tokens") or 0)
    ctx["debate"] = res
    return "ok", (f"{res.get('n_verdicts', 0)} findings tiered · "
                  f"{c.get('confirmed', 0)} confirmed, {c.get('discarded', 0)} discarded."), cost


def _stage_audit(topic: str, ctx: dict) -> tuple[str, str, int]:
    from .debate_run import get_debate_audit
    a = get_debate_audit(topic)
    run = a.get("run") or {}
    if not run:
        return "skipped", "No debate run to audit.", 0
    return "ok", (f"Audit ready · {len(a.get('transcript', []))} turns · "
                  f"{a.get('checks', 0)} checks · {a.get('lineage', 0)} lineage rows."), 0


_STAGE_RUNNERS = {
    "clarify_check": _stage_clarify_check,
    "ground": _stage_ground,
    "synthesize": _stage_synthesize,
    "debate": _stage_debate,
    "audit": _stage_audit,
}

_STAGE_LABEL = {
    "clarify_check": "Clarify", "ground": "Ground agents",
    "synthesize": "Synthesize", "debate": "Debate", "audit": "Audit",
}


def run_fleet_flow(topic: str, *, route: str | None = None,
                   rounds: int = 1, on_stage=None) -> dict[str, Any]:
    """Run a fleet flow over `topic`. `route` ∈ quick|standard|deep (None →
    the decision-gate recommendation). `on_stage(stage_dict)` is called after
    each stage for streaming. Returns the flow result with the stage timeline."""
    gate = decision_gate(topic)
    if not route or route not in ROUTES:
        route = "deep" if gate["mode"] == "complex" else "standard"
    spec = ROUTES[route]
    run_id = uuid.uuid4().hex
    db.record_fleet_run(topic=topic, run_id=run_id, route=route,
                        mode=gate["mode"], signals=gate["signals"])

    ctx: dict[str, Any] = {"rounds": rounds}
    stages: list[dict[str, Any]] = []
    total_cost = 0
    overall = "done"
    for name in spec["stages"]:
        runner = _STAGE_RUNNERS.get(name)
        if runner is None:
            continue
        try:
            status, detail, cost = runner(topic, ctx)
        except Exception as e:  # a stage never crashes the flow
            status, detail, cost = "error", str(e)[:120], 0
        total_cost += int(cost or 0)
        stage = {"name": name, "label": _STAGE_LABEL.get(name, name),
                 "status": status, "detail": detail, "cost_tokens": int(cost or 0)}
        stages.append(stage)
        if callable(on_stage):
            try:
                on_stage(stage)
            except Exception:
                pass
        if status == "error":
            overall = "error"
            break  # stop the flow on a hard error (e.g. synthesis failed)

    db.finish_fleet_run(run_id, status=overall, stages=stages, cost_tokens=total_cost)
    return {
        "ok": overall != "error", "topic": topic, "run_id": run_id,
        "route": route, "route_label": spec["label"], "mode": gate["mode"],
        "status": overall, "stages": stages, "cost_tokens": total_cost,
        "findings": ctx.get("findings", 0),
    }


def get_fleet_status(topic: str) -> dict[str, Any]:
    """Latest fleet flow run for a topic (parsed)."""
    return db.fleet_status_for_topic(topic)


__all__ = ["decision_gate", "plan_routes", "run_fleet_flow", "get_fleet_status"]
