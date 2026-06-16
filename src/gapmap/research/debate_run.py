"""FSD Fleet — topic debate orchestrator (Phase 1).

Wraps the pure 5-persona engine in `deliberate.py` with persistence so the
Topic Map can trigger a debate, render trust badges, and survive reloads.

Flow:
  1. Load the topic's cached findings (`topic_insights.report_json`).
  2. Hash them (staleness key) and open a `debate_runs` row.
  3. Run `deliberate()` over the findings — its heuristic path covers the
     no-LLM case, so this never hard-fails.
  4. Write one `debate_verdicts` row per finding (canonical), refresh the
     denormalized `graph_nodes` debate cache for any matching node, and
     record lineage + a checks-ledger gate per verdict.
  5. Close the run and return a summary for the UI.

Public API:
  run_topic_debate(topic, rounds, provider) -> summary dict
  get_debate_verdicts(topic) -> {verdicts, runs_latest, stale, findings_hash}
"""
from __future__ import annotations

import hashlib
import os
import uuid
from typing import Any

from ..core import db

VALID_TIERS = {"confirmed", "probable", "minority", "discarded"}


def _budget_status(cost_tokens: int) -> dict[str, Any]:
    """Token-budget governance. `GAPMAP_DEBATE_TOKEN_BUDGET` (per-debate, tokens)
    sets the ceiling; returns an alert level the UI can color. level='none'
    when no budget is configured. Costs are estimates (see deliberate.py)."""
    try:
        budget = int(os.getenv("GAPMAP_DEBATE_TOKEN_BUDGET", "0") or "0")
    except Exception:
        budget = 0
    if budget <= 0:
        return {"budget": 0, "cost_tokens": int(cost_tokens or 0), "pct": 0.0, "level": "none"}
    pct = round((cost_tokens or 0) / budget, 3)
    if pct >= 1.0:
        level = "exceeded"
    elif pct >= 0.9:
        level = "critical"
    elif pct >= 0.75:
        level = "warning"
    else:
        level = "ok"
    return {"budget": budget, "cost_tokens": int(cost_tokens or 0), "pct": pct, "level": level}


def _finding_key(item: dict[str, Any]) -> str:
    """Stable title-key used to match a finding across runs and to graph nodes."""
    return (item.get("title") or item.get("label") or "").strip()


def _findings_hash(findings: list[dict[str, Any]]) -> str:
    """Stable hash over finding title-keys — flips when the finding set changes."""
    keys = sorted(_finding_key(f).lower() for f in findings if _finding_key(f))
    h = hashlib.sha256("␟".join(keys).encode("utf-8")).hexdigest()
    return h[:16]


def _node_label_map(topic: str) -> dict[str, str]:
    """{normalized label -> graph_nodes.id} for this topic. Empty on any error."""
    try:
        d = db.get_db()
        if "graph_nodes" not in d.table_names():
            return {}
        out: dict[str, str] = {}
        for r in d.query(
            "SELECT id, label FROM graph_nodes WHERE topic = ?", [topic]
        ):
            lbl = (r.get("label") or "").strip().lower()
            if lbl and lbl not in out:
                out[lbl] = r.get("id")
        return out
    except Exception:
        return {}


def _consensus_of(item: dict[str, Any]) -> dict[str, Any]:
    return item.get("consensus") or {}


def run_topic_debate(
    topic: str,
    *,
    rounds: int = 1,
    provider: str | None = None,
    dynamic_roles: bool = False,
) -> dict[str, Any]:
    """Run + persist a debate over a topic's cached findings.

    Returns a summary dict. When no findings are cached, returns
    `{ok: False, reason: 'needs_synthesis'}` instead of raising — the UI
    prompts the user to synthesize first.
    """
    from .insights import load_insights

    report = load_insights(topic)
    findings = (report or {}).get("findings") if isinstance(report, dict) else None
    if not findings or not isinstance(findings, list):
        return {"ok": False, "reason": "needs_synthesis", "topic": topic}

    findings_hash = _findings_hash(findings)
    run_id = uuid.uuid4().hex
    model = ""
    try:
        import os
        model = os.getenv("LLM_MODEL") or ""
    except Exception:
        pass

    db.record_debate_run(
        topic=topic, run_id=run_id, rounds=rounds, status="running",
        provider=provider or "", model=model,
    )

    # ── Run the pure engine (never raises; heuristic fallback on no LLM) ──
    try:
        from .deliberate import deliberate, generate_debate_roles
        roles = generate_debate_roles(topic, provider=provider) if dynamic_roles else None
        result = deliberate(
            findings, topic=topic, rounds=rounds,
            provider=provider, use_llm=True, persist_log=True, roles=roles,
        )
    except Exception as e:
        db.finish_debate_run(run_id, status="error")
        return {"ok": False, "reason": "deliberate_failed",
                "topic": topic, "error": str(e)[:200]}

    node_map = _node_label_map(topic)
    db.clear_debate_verdicts(topic)

    counts = {"confirmed": 0, "probable": 0, "minority": 0, "discarded": 0}
    n_verdicts = 0
    used_fallback = False

    for tier_key, tier_items in (result.get("tiers") or {}).items():
        if tier_key not in VALID_TIERS:
            continue
        for item in tier_items:
            cons = _consensus_of(item)
            tier = cons.get("tier") or tier_key
            if tier not in VALID_TIERS:
                tier = tier_key
            score = float(cons.get("score") or 0.0)
            fallback = bool(cons.get("fallback"))
            used_fallback = used_fallback or fallback
            provenance = "llm_fallback" if fallback else "debated"
            dissent = (cons.get("rationales") or {}).get("dispute") or []
            posts = item.get("supporting_post_ids") or []
            key = _finding_key(item)
            if not key:
                continue

            db.record_debate_verdict(
                topic=topic, target_kind="finding", target_id=key,
                tier=tier, consensus_score=score, dissent=dissent,
                evidence_post_ids=posts, findings_hash=findings_hash,
                run_id=run_id, provenance=provenance,
                provider=result.get("provider") or "", model=model,
            )
            db.record_lineage(
                topic=topic, artifact_id=key, artifact_kind="debate_verdict",
                produced_by="deliberate", from_post_ids=posts, decision=tier,
                provider=result.get("provider") or "", model=model,
            )
            db.record_check(
                topic=topic, run_id=run_id, gate="debate_consensus",
                operation="deliberate",
                invariant="tier in {confirmed,probable,minority,discarded}",
                passed=tier in VALID_TIERS, provider=result.get("provider") or "",
                model=model, detail=f"{key[:80]} -> {tier} ({score:.2f})",
            )

            # Refresh the denormalized render cache for any matching node.
            node_id = node_map.get(key.lower())
            if node_id:
                db.set_node_debate_cache(topic, node_id, tier=tier, score=score)

            counts[tier] = counts.get(tier, 0) + 1
            n_verdicts += 1

    # Phase 3 — enrich the raw transcript with the finding each vote targets,
    # so the replay timeline reads "Skeptic disputed <finding>" not just "i=2".
    raw_transcript = result.get("transcripts") or []
    audit_transcript = []
    for t in raw_transcript:
        idx = t.get("i")
        target = ""
        if isinstance(idx, int) and 0 <= idx < len(findings):
            target = _finding_key(findings[idx])
        audit_transcript.append({
            "round": t.get("round"),
            "persona": t.get("persona"),
            "vote": t.get("vote"),
            "rationale": t.get("rationale"),
            "target": target,
        })
    cost_tokens = int(result.get("cost_tokens_est") or 0)
    audit_counts = dict(counts)
    audit_counts["n_findings"] = len(findings)
    audit_counts["llm_calls"] = len(result.get("personas_used") or []) * int(result.get("rounds") or 0)
    audit_counts["cost_tokens_est"] = cost_tokens

    db.finish_debate_run(run_id, status="done", cost_tokens=cost_tokens,
                         transcript=audit_transcript, counts=audit_counts)

    return {
        "cost_tokens": cost_tokens,
        "budget": _budget_status(cost_tokens),
        "ok": True,
        "topic": topic,
        "run_id": run_id,
        "findings_hash": findings_hash,
        "n_input": result.get("n_input", len(findings)),
        "n_verdicts": n_verdicts,
        "rounds": result.get("rounds"),
        "counts": counts,
        "personas_used": result.get("personas_used") or [],
        "audience_grounded": result.get("audience_grounded", False),
        "persona_grounded": result.get("persona_grounded", False),
        "provider": result.get("provider") or "",
        "provenance": "llm_fallback" if used_fallback else "debated",
        "stale": False,
    }


def get_debate_verdicts(topic: str) -> dict[str, Any]:
    """Read persisted verdicts for the Map, flagging staleness against the
    current findings. Never raises."""
    from .insights import load_insights

    current_hash = ""
    try:
        report = load_insights(topic)
        findings = (report or {}).get("findings") if isinstance(report, dict) else None
        if findings and isinstance(findings, list):
            current_hash = _findings_hash(findings)
    except Exception:
        current_hash = ""

    out = db.debate_verdicts_for_topic(topic, current_hash=current_hash)
    out["current_findings_hash"] = current_hash
    out["ok"] = True
    out["topic"] = topic
    return out


def get_debate_audit(topic: str) -> dict[str, Any]:
    """Phase 3 — replay/audit payload for the topic's latest debate (run header,
    per-round per-persona transcript, tier counts, provenance gate counts) plus
    token-budget status."""
    out = db.debate_audit_for_topic(topic)
    run = out.get("run") or {}
    out["budget"] = _budget_status(int(run.get("cost_tokens") or 0))
    return out


__all__ = ["run_topic_debate", "get_debate_verdicts", "get_debate_audit"]
