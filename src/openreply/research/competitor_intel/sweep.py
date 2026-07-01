"""Competitor sweep runner: fetch → extract → sentiment → signals → snapshot/delta."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from ...core.db import get_db
from . import registry, signals


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Isolated wrappers (monkeypatched in tests) ────────────────────────────────
def _collect(topic, sources, keywords, provider, progress) -> dict[str, Any]:
    from ..collect import collect

    res = collect(topic=topic, sources=sources, extra_keywords=keywords,
                  skip_reddit=False, progress=progress)
    return {"posts_fetched": getattr(res, "posts_fetched", 0)}


def _find_gaps(topic, provider) -> dict[str, Any]:
    from ..gaps import find_gaps

    return find_gaps(topic, provider=provider)


def _sentiment(topic, provider) -> dict[str, Any]:
    from ...analyze.sentiment import sentiment_by_source

    return sentiment_by_source(topic, provider=provider)


def _enrich_graph(topic) -> None:
    try:
        from ...graph.semantic import enrich_from_llm

        enrich_from_llm(topic=topic)
    except Exception:
        pass


# ── Snapshot helpers ─────────────────────────────────────────────────────────
def latest_snapshot(product_id: str, competitor_name: str) -> dict[str, Any] | None:
    db = get_db()
    rows = list(
        db["competitor_snapshots"].rows_where(
            "product_id = ? and competitor_name = ?",
            [product_id, competitor_name],
            order_by="id desc",
            limit=1,
        )
    )
    if not rows:
        return None
    r = rows[0]
    return {
        "id": r["id"],
        "metrics": json.loads(r.get("metrics_json") or "{}"),
        "delta": json.loads(r.get("delta_json") or "{}"),
        "summary": r.get("summary") or "",
        "created_at": r.get("created_at"),
    }


def _compute_delta(prev: dict | None, metrics: dict) -> dict[str, Any]:
    if not prev:
        return {"new_complaints": metrics.get("complaint_count", 0),
                "sentiment_change": 0.0, "first_run": True}
    pm = prev.get("metrics", {})
    return {
        "new_complaints": max(0, metrics.get("complaint_count", 0) - pm.get("complaint_count", 0)),
        "sentiment_change": round(
            metrics.get("sentiment_score", 0.0) - pm.get("sentiment_score", 0.0), 3
        ),
        "first_run": False,
    }


# ── Main entry point ─────────────────────────────────────────────────────────
def run_competitor_sweep(
    product_id: str,
    competitor_name: str,
    *,
    sources: list[str] | None = None,
    rebuild: bool = False,
    provider: str | None = None,
    trigger: str = "manual",
    progress=None,
) -> dict[str, Any]:
    comp = registry.get_competitor(product_id, competitor_name)
    if not comp:
        return {"ok": False, "error": "competitor not found"}
    topic = comp["topic"]
    src = sources or (comp["source_config"].get("enabled_adapters") or registry.DEFAULT_SOURCE_PACK)
    keywords = [competitor_name, *comp.get("aliases", [])]

    fetched = _collect(topic, src, keywords, provider, progress)
    _enrich_graph(topic)
    gaps = _find_gaps(topic, provider)
    sent = _sentiment(topic, provider)

    n_find = n_opp = 0
    for pp in gaps.get("painpoints", []) + gaps.get("product_complaints", []):
        signals.write_signal(
            product_id, competitor_name, signal_type="complaint",
            title=pp.get("label", "")[:200], description=pp.get("summary", ""),
            severity=float(pp.get("severity", 0.5) or 0.5),
            evidence_post_ids=pp.get("evidence_post_ids", []),
        )
        n_find += 1
    for fw in gaps.get("feature_wishes", []):
        signals.write_signal(
            product_id, competitor_name, signal_type=signals.OPPORTUNITY_KIND,
            title=fw.get("label", "")[:200],
            description=fw.get("summary", ""),
            suggested_action="Build what this competitor lacks.",
            severity=float(fw.get("severity", 0.5) or 0.5),
            evidence_post_ids=fw.get("evidence_post_ids", []),
        )
        n_opp += 1

    complaint_count = n_find
    metrics = {
        "complaint_count": complaint_count,
        "sentiment_score": sent.get("overall", 0.0),
        "top_painpoints": [p.get("label") for p in gaps.get("painpoints", [])[:5]],
        "mentions_by_source": {k: v.get("n", 0) for k, v in sent.get("by_source", {}).items()},
        "posts_fetched": fetched.get("posts_fetched", 0),
    }
    prev = latest_snapshot(product_id, competitor_name)
    delta = _compute_delta(prev, metrics)

    db = get_db()
    sweep_id = db["product_sweeps"].insert(
        {
            "product_id": product_id,
            "run_at": _now(),
            "trigger": trigger,
            "signals_generated": n_find + n_opp,
            "posts_added": fetched.get("posts_fetched", 0),
            "duration_ms": 0,
            "error": "",
            "notes": f"competitor:{competitor_name}",
        }
    ).last_pk
    snap_id = db["competitor_snapshots"].insert(
        {
            "product_id": product_id,
            "competitor_name": competitor_name,
            "sweep_id": sweep_id,
            "created_at": _now(),
            "metrics_json": json.dumps(metrics),
            "summary": "",
            "delta_json": json.dumps(delta),
        }
    ).last_pk

    registry.update_competitor(product_id, competitor_name)  # bump updated_at
    return {
        "ok": True,
        "competitor": competitor_name,
        "topic": topic,
        "posts_fetched": fetched.get("posts_fetched", 0),
        "findings": n_find,
        "opportunities": n_opp,
        "snapshot_id": snap_id,
        "delta": delta,
    }
