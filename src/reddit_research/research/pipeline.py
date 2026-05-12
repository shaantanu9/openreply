"""End-to-end discovery pipeline orchestrator.

Chains audience → synthesize → deliberate → launch_brief in order, with
per-topic best-config overrides automatically applied from
`topic_pipeline_config`. The user clicks ONE button in the GUI; the
sidecar walks the chain.

Returns a stage-by-stage status report so the UI can light up each
checkpoint as it completes:

    {
      ok, topic, started_at, ended_at,
      stages: [
        {name: "audience",   status: "ok"|"skip"|"error", detail: {...}},
        {name: "synthesize", status, detail},
        {name: "deliberate", status, detail},
        {name: "launch",     status, detail},
      ],
      summary: { audience_clusters, findings_total, findings_confirmed,
                 launch_brief_ready }
    }

`run_pipeline()` is safe to call repeatedly — every stage detects
already-done state (cached audience personas, cached topic_insights,
cached launch_briefs) and skips when fresh enough. Force a clean re-run
with `force=True`.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db
from . import iterate as it_mod


def _staleness_ok(generated_at: str | None, max_age_hours: float = 24.0) -> bool:
    if not generated_at:
        return False
    try:
        dt = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    except Exception:
        return False
    age_h = (datetime.now(timezone.utc) - dt).total_seconds() / 3600.0
    return age_h < max_age_hours


def _stage_audience(topic: str, *, force: bool, llm: bool) -> dict[str, Any]:
    from .audience import get_audience_personas, build_audience_personas
    if not force:
        cached = get_audience_personas(topic)
        if cached.get("ok") and cached.get("personas"):
            generated = (cached["personas"] or [{}])[0].get("generated_at")
            if _staleness_ok(generated):
                return {
                    "name": "audience", "status": "skip",
                    "detail": {"reason": "fresh cache",
                               "n_clusters": len(cached["personas"]),
                               "generated_at": generated},
                }
    applied = it_mod.get_applied_config(topic, "audience") or {}
    cfg = applied.get("config") or {}
    res = build_audience_personas(
        topic=topic,
        llm=llm,
        provider=None,
        persist=True,
        min_posts_per_author=int(cfg.get("min_posts", 3)),
        k_candidates=tuple(cfg.get("k_candidates", [3, 5, 7])),
    )
    if not res.get("ok"):
        return {"name": "audience", "status": "error",
                "detail": {"error": res.get("error", "unknown")[:200]}}
    return {
        "name": "audience", "status": "ok",
        "detail": {
            "n_clusters": len(res.get("personas") or []),
            "n_authors_clustered": res.get("n_authors_clustered"),
            "n_authors_total": res.get("n_authors_total"),
            "silhouette": res.get("silhouette"),
            "applied_config_used": bool(cfg),
        },
    }


def _stage_synthesize(topic: str, *, force: bool, llm_provider: str | None,
                      enable_deliberate: bool) -> dict[str, Any]:
    from .insights import synthesize_insights
    db = get_db()
    if not force and "topic_insights" in db.table_names():
        row = db.execute(
            "SELECT generated_at FROM topic_insights WHERE topic = ?", [topic],
        ).fetchone()
        if row and row[0] and _staleness_ok(row[0]):
            return {"name": "synthesize", "status": "skip",
                    "detail": {"reason": "fresh cache", "generated_at": row[0]}}
    res = synthesize_insights(
        topic=topic, provider=llm_provider, persist=True,
        min_score=0,
        deliberate=enable_deliberate, deliberate_rounds=1,
    )
    if not res or res.get("ok") is False:
        return {"name": "synthesize", "status": "error",
                "detail": {"error": (res or {}).get("error", "unknown")[:200]}}
    findings = res.get("findings") or []
    counts = {"total": len(findings)}
    if any(("consensus" in f for f in findings)):
        for tier in ("confirmed", "probable", "minority", "discarded"):
            counts[tier] = sum(
                1 for f in findings
                if (f.get("consensus") or {}).get("tier") == tier
            )
    return {"name": "synthesize", "status": "ok", "detail": counts}


def _stage_deliberate(topic: str, *, force: bool) -> dict[str, Any]:
    """If synthesize already ran with deliberate=True, this is a no-op
    skip. Otherwise we re-tier the cached findings now."""
    from .deliberate import deliberate as _run
    db = get_db()
    if "topic_insights" not in db.table_names():
        return {"name": "deliberate", "status": "error",
                "detail": {"error": "no insights row to tier"}}
    row = db.execute(
        "SELECT report_json FROM topic_insights WHERE topic = ?", [topic],
    ).fetchone()
    if not row or not row[0]:
        return {"name": "deliberate", "status": "error",
                "detail": {"error": "no insights cache"}}
    try:
        report = json.loads(row[0])
    except Exception:
        return {"name": "deliberate", "status": "error",
                "detail": {"error": "insights row unparseable"}}
    findings = report.get("findings") or []
    if not findings:
        return {"name": "deliberate", "status": "skip",
                "detail": {"reason": "no findings to tier"}}
    if not force and any("consensus" in f for f in findings):
        return {"name": "deliberate", "status": "skip",
                "detail": {"reason": "findings already tiered"}}
    applied = it_mod.get_applied_config(topic, "deliberate") or {}
    cfg = applied.get("config") or {}
    res = _run(
        findings, topic=topic,
        rounds=int(cfg.get("rounds", 1)),
        use_llm=bool(cfg.get("use_llm", True)),
        persist_log=True,
    )
    return {"name": "deliberate", "status": "ok",
            "detail": {"counts": res.get("counts"),
                       "audience_grounded": res.get("audience_grounded"),
                       "rounds": res.get("rounds"),
                       "applied_config_used": bool(cfg)}}


def _stage_launch(topic: str, *, force: bool, llm: bool,
                  llm_provider: str | None) -> dict[str, Any]:
    from .launch import build_launch_brief, get_launch_brief
    if not force:
        cached = get_launch_brief(topic)
        if cached.get("ok") and _staleness_ok(cached.get("generated_at")):
            return {"name": "launch", "status": "skip",
                    "detail": {"reason": "fresh cache",
                               "generated_at": cached.get("generated_at")}}
    res = build_launch_brief(topic=topic, llm=llm,
                             provider=llm_provider, persist=True)
    if not res.get("ok"):
        return {"name": "launch", "status": "error",
                "detail": {"error": res.get("error", "unknown")[:200]}}
    return {"name": "launch", "status": "ok",
            "detail": {
                "n_personas": len(res.get("audience", {}).get("icp_personas") or []),
                "n_channels": len(res.get("launch_channels") or []),
                "llm_augmented": res.get("llm_augmented"),
            }}


def run_pipeline(
    topic: str,
    *,
    force: bool = False,
    llm: bool = True,
    llm_provider: str | None = None,
) -> dict[str, Any]:
    """Walk the full chain: audience → synthesize → deliberate → launch.

    Each stage:
      - skips when a fresh cache exists (unless force=True),
      - reads the per-topic best config from topic_pipeline_config,
      - returns a status: ok | skip | error.

    Returns the full stage report so the UI can render a checkpoint
    list."""
    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    stages: list[dict[str, Any]] = []
    stages.append(_stage_audience(topic, force=force, llm=llm))
    stages.append(_stage_synthesize(
        topic, force=force, llm_provider=llm_provider,
        enable_deliberate=True,    # always tier when running the pipeline
    ))
    # If synthesize already deliberated (enable_deliberate=True above),
    # the deliberate stage will skip with "already tiered".
    stages.append(_stage_deliberate(topic, force=force))
    stages.append(_stage_launch(topic, force=force, llm=llm, llm_provider=llm_provider))

    summary: dict[str, Any] = {}
    a = next((s for s in stages if s["name"] == "audience"), None)
    if a:
        summary["audience_clusters"] = a.get("detail", {}).get("n_clusters", 0)
    s = next((st for st in stages if st["name"] == "synthesize"), None)
    if s and s.get("status") == "ok":
        summary["findings_total"]    = s.get("detail", {}).get("total", 0)
        summary["findings_confirmed"] = s.get("detail", {}).get("confirmed", 0)
    summary["launch_brief_ready"] = any(
        st["name"] == "launch" and st["status"] in ("ok", "skip") for st in stages
    )
    summary["any_error"] = any(st["status"] == "error" for st in stages)

    return {
        "ok": not summary["any_error"],
        "topic": topic,
        "started_at": started,
        "ended_at":   datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "stages": stages,
        "summary": summary,
        "force": force,
    }


def pipeline_status(topic: str) -> dict[str, Any]:
    """Lightweight read of the four cache tables — does each stage have
    fresh data? Drives the GUI checkpoint list without running anything."""
    db = get_db()
    out = {"topic": topic, "stages": []}

    # Audience
    n_clu = 0
    aud_age = None
    if "audience_personas" in db.table_names():
        row = db.execute(
            "SELECT COUNT(*), MAX(generated_at) FROM audience_personas WHERE topic = ?",
            [topic],
        ).fetchone()
        if row:
            n_clu = row[0] or 0
            aud_age = row[1]
    out["stages"].append({
        "name": "audience",
        "ready": n_clu > 0,
        "fresh": _staleness_ok(aud_age),
        "detail": {"n_clusters": n_clu, "generated_at": aud_age},
    })

    # Synthesize + deliberate share the topic_insights row, so we read
    # it once and derive both stages from a single decoded payload.
    syn_age = None
    n_findings = 0
    n_confirmed = 0
    n_with_consensus = 0
    if "topic_insights" in db.table_names():
        row = db.execute(
            "SELECT generated_at, report_json FROM topic_insights WHERE topic = ?",
            [topic],
        ).fetchone()
        if row:
            syn_age = row[0]
            try:
                rep = json.loads(row[1]) if row[1] else {}
                fs = rep.get("findings") or []
                n_findings = len(fs)
                for f in fs:
                    cons = f.get("consensus") or {}
                    if cons:
                        n_with_consensus += 1
                        if cons.get("tier") == "confirmed":
                            n_confirmed += 1
            except Exception:
                pass
    out["stages"].append({
        "name": "synthesize",
        "ready": n_findings > 0,
        "fresh": _staleness_ok(syn_age),
        "detail": {"n_findings": n_findings, "n_confirmed": n_confirmed,
                   "generated_at": syn_age},
    })

    out["stages"].append({
        "name": "deliberate",
        "ready": n_with_consensus > 0,
        "fresh": _staleness_ok(syn_age),    # tied to synthesize cache
        "detail": {"n_confirmed": n_confirmed,
                   "n_tiered": n_with_consensus,
                   "n_findings": n_findings},
    })

    # Launch
    lb_age = None
    if "launch_briefs" in db.table_names():
        row = db.execute(
            "SELECT generated_at FROM launch_briefs WHERE topic = ?", [topic],
        ).fetchone()
        if row:
            lb_age = row[0]
    out["stages"].append({
        "name": "launch",
        "ready": lb_age is not None,
        "fresh": _staleness_ok(lb_age),
        "detail": {"generated_at": lb_age},
    })

    out["overall_ready"] = all(s["ready"] for s in out["stages"])
    out["overall_fresh"] = all(s["fresh"] for s in out["stages"])
    return out
