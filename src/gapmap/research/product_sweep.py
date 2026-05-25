"""Dual-Mode Pivot — per-product daily sweep engine.

Runs one pass of: fresh collect → synthesize diff → emit typed signals →
persist. This is the heartbeat that makes Gap Map a daily-use tool for PMs.

Pipeline:
  1. Load the product + its linked topic
  2. Re-run synthesize (reuses Phase 1+2 engine, via monitor.run_topic_refresh)
     to get a fresh report + diff vs last run
  3. Translate the diff + extracted signals into typed product_signals rows
     (see signals.py for the 6 canonical types)
  4. Persist sweep summary + signals
  5. Return signals for the UI to consume

Degrades gracefully: if synthesize fails (no LLM, rate limit), we still
record the sweep attempt and surface an error signal.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from ..core.db import get_db, init_schema
from . import signals as sig_mod
from . import product as product_mod


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _score_delta_signals(
    product_id: str,
    score_changes: list[dict],
    threshold: float = 1.0,
) -> list[dict]:
    """Score jumps ≥threshold → unmet_need_intensifying signals."""
    out = []
    for ch in score_changes or []:
        prev = ch.get("previous_score") or ch.get("prev_score") or 0.0
        curr = ch.get("current_score") or ch.get("curr_score") or 0.0
        if (curr - prev) < threshold:
            continue
        out.append(sig_mod.unmet_need_intensifying(
            product_id=product_id,
            need=ch.get("title") or ch.get("finding_title") or "unnamed",
            prev_score=prev,
            curr_score=curr,
            evidence_post_ids=ch.get("evidence_post_ids") or [],
            confidence=0.75,
        ))
    return out


def _added_findings_signals(
    product_id: str,
    findings_added: list[dict],
    min_score: float = 12.0,
) -> list[dict]:
    """New high-score findings → chronic_emergence signals."""
    out = []
    for f in findings_added or []:
        score = f.get("opportunity_score") or 0
        if score < min_score:
            continue
        out.append(sig_mod.chronic_emergence(
            product_id=product_id,
            painpoint=f.get("title") or "unnamed painpoint",
            opportunity_score=float(score),
            evidence_post_ids=f.get("evidence_post_ids") or [],
            confidence=0.7,
        ))
    return out


def _competitor_signals(
    product_id: str,
    report: dict,
    tracked_competitors: set[str],
) -> list[dict]:
    """Walk competitors[] in the report; emit vulnerability/release signals."""
    out = []
    for c in (report.get("competitors") or []):
        cname = (c.get("name") or "").strip()
        if not cname:
            continue
        # Only emit for tracked competitors. Lowercase match to be forgiving.
        cl = cname.lower()
        match = next((t for t in tracked_competitors if t.lower() == cl or cl in t.lower() or t.lower() in cl), None)
        if not match:
            continue
        # Vulnerability signal per non-empty weakness
        for w in (c.get("weaknesses") or [])[:2]:
            if not w:
                continue
            out.append(sig_mod.competitor_vulnerability(
                product_id=product_id,
                competitor=match,
                weakness=w,
                sentiment_hint="",
                evidence_post_ids=[],
                severity=0.5,
                confidence=0.6,
            ))
    return out


def _persist_signals(signals: list[dict]) -> int:
    """Insert signals in one batch. Returns inserted count."""
    if not signals:
        return 0
    db = get_db()
    init_schema(db)
    db["product_signals"].insert_all(signals)
    return len(signals)


def _persist_sweep(
    product_id: str,
    trigger: str,
    signals_generated: int,
    posts_added: int,
    duration_ms: int,
    error: str = "",
    notes: str = "",
) -> int:
    db = get_db()
    init_schema(db)
    row_id = db["product_sweeps"].insert({
        "product_id": product_id,
        "run_at": _utc_now(),
        "trigger": trigger,
        "signals_generated": signals_generated,
        "posts_added": posts_added,
        "duration_ms": duration_ms,
        "error": error,
        "notes": notes,
    }).last_pk
    # Update last_swept_at on product
    try:
        product_mod.update_product(product_id, {"last_swept_at": _utc_now()})
    except Exception:
        pass
    return row_id


def run_product_sweep(
    product_id: str,
    trigger: str = "manual",
    skip_collect: bool = True,
) -> dict[str, Any]:
    """Run one sweep for a product.

    Args:
        product_id: product slug
        trigger: manual | scheduled | initial
        skip_collect: if False, re-fetch sources before synthesizing

    Returns:
        {ok, product_id, sweep_id, signals: [...], delta: {...}, error?}
    """
    started = time.time()
    db = get_db()
    init_schema(db)

    # 1. Load product
    pinfo = product_mod.get_product(product_id)
    if not pinfo.get("ok"):
        return {"ok": False, "error": pinfo.get("error", "product not found")}
    product = pinfo["product"]
    competitors = {c["competitor_name"] for c in pinfo.get("competitors", [])}
    topic = product.get("topic") or product_id

    # 2. Run synthesize via monitor.run_topic_refresh — gives us the diff
    try:
        from .monitor import run_topic_refresh
    except Exception as e:
        duration_ms = int((time.time() - started) * 1000)
        _persist_sweep(product_id, trigger, 0, 0, duration_ms,
                       error=f"monitor import failed: {e}")
        return {"ok": False, "error": f"monitor import failed: {e}"}

    try:
        run_result = run_topic_refresh(
            topic=topic, trigger=trigger, skip_collect=skip_collect,
        )
    except Exception as e:
        duration_ms = int((time.time() - started) * 1000)
        _persist_sweep(product_id, trigger, 0, 0, duration_ms,
                       error=f"synthesize failed: {e}")
        return {"ok": False, "error": f"synthesize failed: {e}"}

    if not run_result or not run_result.get("ok"):
        duration_ms = int((time.time() - started) * 1000)
        err = (run_result or {}).get("error", "synthesize returned no report")
        _persist_sweep(product_id, trigger, 0, 0, duration_ms, error=err)
        return {"ok": False, "error": err}

    report = run_result.get("report") or {}
    delta = run_result.get("delta") or {}

    # 3. Translate to typed signals
    out_signals: list[dict] = []
    out_signals.extend(_added_findings_signals(
        product_id, delta.get("findings_added") or [],
    ))
    out_signals.extend(_score_delta_signals(
        product_id, delta.get("score_changes") or [],
    ))
    out_signals.extend(_competitor_signals(
        product_id, report, competitors,
    ))

    # 4. Persist
    inserted = _persist_signals(out_signals)
    posts_added = (delta.get("corpus_size_change") or {}).get("added", 0) if isinstance(delta.get("corpus_size_change"), dict) else 0
    duration_ms = int((time.time() - started) * 1000)
    sweep_id = _persist_sweep(
        product_id, trigger, inserted, posts_added, duration_ms,
        notes=f"findings_added={len(delta.get('findings_added') or [])} score_changes={len(delta.get('score_changes') or [])}",
    )

    return {
        "ok": True,
        "product_id": product_id,
        "sweep_id": sweep_id,
        "signals_generated": inserted,
        "signals": out_signals,
        "delta": delta,
        "duration_ms": duration_ms,
    }


# ── Signal listing + actions ────────────────────────────────────────────
def list_signals(
    product_id: str,
    since_days: Optional[int] = None,
    include_resolved: bool = False,
    limit: int = 100,
) -> list[dict]:
    db = get_db()
    if "product_signals" not in db.table_names():
        return []
    clauses = ["product_id = ?"]
    params: list[Any] = [product_id]
    if not include_resolved:
        # Show open (no user_action) + snoozed-that-expired
        clauses.append(
            "(user_action IS NULL OR user_action = '' "
            "OR (user_action = 'snoozed' AND (snoozed_until IS NULL OR snoozed_until = '' OR snoozed_until < ?)))"
        )
        params.append(_utc_now())
    if since_days:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=since_days)).isoformat(timespec="seconds")
        clauses.append("detected_at >= ?")
        params.append(cutoff)
    sql = (
        "SELECT * FROM product_signals WHERE "
        + " AND ".join(clauses)
        + " ORDER BY (severity * confidence) DESC, detected_at DESC LIMIT ?"
    )
    params.append(limit)
    rows = list(db.query(sql, params))
    for r in rows:
        try:
            r["evidence_post_ids"] = json.loads(r.get("evidence_post_ids") or "[]")
        except Exception:
            r["evidence_post_ids"] = []
    return rows


def signal_action(
    signal_id: str,
    action: str,
    notes: str = "",
    snooze_days: int = 7,
) -> dict[str, Any]:
    """Apply a user action to a signal.

    action ∈ dismissed | acted | snoozed | hypothesis
    """
    db = get_db()
    if "product_signals" not in db.table_names():
        return {"ok": False, "error": "product_signals table not initialized"}
    if action not in ("dismissed", "acted", "snoozed", "hypothesis"):
        return {"ok": False, "error": f"unknown action: {action}"}
    now = _utc_now()
    snoozed_until = ""
    if action == "snoozed":
        snoozed_until = (datetime.now(timezone.utc) + timedelta(days=max(1, snooze_days))).isoformat(timespec="seconds")
    db.execute(
        "UPDATE product_signals SET user_action = ?, user_action_at = ?, "
        "snoozed_until = ?, resolution_notes = ? WHERE id = ?",
        [action, now, snoozed_until, notes, signal_id],
    )
    try:
        db.conn.commit()
    except Exception:
        pass

    # Side effect: if action = hypothesis, seed a bet via hypothesis_tracker.
    if action == "hypothesis":
        try:
            from .hypothesis_tracker import create_hypothesis_test
            rows = list(db.query(
                "SELECT product_id, title, description, evidence_post_ids, signal_type "
                "FROM product_signals WHERE id = ?", [signal_id]))
            if rows:
                r = rows[0]
                pinfo = product_mod.get_product(r["product_id"])
                topic = pinfo.get("product", {}).get("topic") if pinfo.get("ok") else r["product_id"]
                card = {
                    "finding_title": r["title"],
                    "experiences": r["title"],
                    "we_believe": r["description"],
                    "and_would": "see a measurable improvement in the signal this week",
                    "for": "our product users",
                    "falsifiers": [
                        "signal severity does not drop by 50% in 14 days",
                        "no new supporting posts in the evidence set",
                    ],
                    "cheapest_test": "Ship the smallest version; monitor the signal for 2 weeks",
                    "time_box_days": 14,
                    "budget_usd": 0,
                    "_from_signal_id": signal_id,
                    "_signal_type": r["signal_type"],
                }
                create_hypothesis_test(topic=topic, card=card)
        except Exception:
            pass  # don't fail the action over a side-effect error

    return {"ok": True, "signal_id": signal_id, "action": action,
            "at": now, "snoozed_until": snoozed_until}


def signal_counts(product_id: str) -> dict[str, int]:
    """Per-type + per-status count."""
    db = get_db()
    if "product_signals" not in db.table_names():
        return {}
    out: dict[str, int] = {}
    for r in db.query(
        "SELECT signal_type, coalesce(user_action,'open') AS bucket, count(*) AS n "
        "FROM product_signals WHERE product_id = ? "
        "GROUP BY signal_type, bucket",
        [product_id],
    ):
        out[f"{r['signal_type']}::{r['bucket']}"] = r["n"]
    return out


__all__ = [
    "run_product_sweep",
    "list_signals",
    "signal_action",
    "signal_counts",
]
