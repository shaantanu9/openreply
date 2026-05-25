"""MoSCoW prioritization (Dai Clegg, Oracle UK, 1994).

Sibling of :mod:`research.kano` — same shape, same idempotency contract,
different axis. Each intervention gets a Must / Should / Could / Won't
tag stored in ``graph_nodes.metadata_json.moscow``.

The 'Won't' bucket is the value-add over Kano: it documents non-goals
explicitly so stakeholders cannot quietly re-introduce scope later.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from ..analyze.providers.base import get_provider
from ..core.db import get_db, save_mcp_analysis
from .prompts import load_extractor


VALID_MOSCOW = {"must", "should", "could", "wont"}
VALID_CONFIDENCE = {"low", "med", "high"}


def _parse_json(raw: str) -> dict[str, Any]:
    cleaned = (raw or "").strip()
    for fence in ("```json", "```"):
        if cleaned.startswith(fence):
            cleaned = cleaned[len(fence):].lstrip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
        return {"_parse_error": True, "_raw": raw}
    except json.JSONDecodeError:
        return {"_parse_error": True, "_raw": raw}


def _format_why(meta: dict[str, Any]) -> str:
    why = meta.get("why") or {}
    if not why or why.get("_skipped") or why.get("_parse_error"):
        return "(no why-data — use intervention text alone)"
    statement = (why.get("jtbd_statement") or "").strip()
    jtbd = why.get("jtbd") or {}
    parts = []
    if statement:
        parts.append(f"JTBD: {statement}")
    parts.append(f"Struggling moment: {jtbd.get('struggling_moment', '?')}")
    parts.append(f"Desired outcome: {jtbd.get('desired_outcome', '?')}")
    emotions = ", ".join(why.get("emotions") or [])
    if emotions:
        parts.append(f"Emotions: {emotions}")
    return "\n".join(parts)


def categorize_interventions_for_painpoint(
    painpoint_label: str,
    why_meta: dict[str, Any],
    interventions: list[dict[str, Any]],
    provider: Optional[str] = None,
) -> dict[str, Any]:
    if not interventions:
        return {"_skipped": True, "reason": "no_interventions"}
    ext = load_extractor("moscow")
    intv_lines = "\n".join(
        f"{iv['id']} :: {(iv.get('label') or '').strip()}" for iv in interventions
    )
    user = ext["user_template"].format(
        painpoint_label=painpoint_label,
        why=_format_why(why_meta),
        interventions=intv_lines,
    )
    raw = get_provider(provider).complete(
        prompt=user, system=ext["system"], max_tokens=900, temperature=0.2,
    )
    return _parse_json(raw)


def _persist_moscow(
    db, intervention_id: str, moscow: str, confidence: str, reasoning: str,
) -> bool:
    if moscow not in VALID_MOSCOW:
        return False
    if confidence not in VALID_CONFIDENCE:
        confidence = "med"
    row = db["graph_nodes"].get(intervention_id)
    if not row:
        return False
    try:
        meta = json.loads(row.get("metadata_json") or "{}") or {}
    except (json.JSONDecodeError, TypeError):
        meta = {}
    meta["moscow"] = moscow
    meta["moscow_confidence"] = confidence
    if reasoning:
        meta["moscow_reasoning"] = reasoning[:500]
    db["graph_nodes"].update(intervention_id, {"metadata_json": json.dumps(meta)})
    return True


def categorize_topic(topic: str, provider: Optional[str] = None) -> dict[str, Any]:
    """One LLM call per painpoint — same as Kano. Idempotent."""
    db = get_db()
    summary: dict[str, Any] = {
        "topic": topic,
        "painpoints_processed": 0,
        "interventions_categorized": 0,
        "skipped_painpoints": 0,
    }
    if "graph_nodes" not in db.table_names():
        return summary

    pps = list(db.query(
        "SELECT id, label, metadata_json FROM graph_nodes "
        "WHERE topic = :t AND kind = 'painpoint'",
        {"t": topic},
    ))
    for pp in pps:
        try:
            why_meta = json.loads(pp.get("metadata_json") or "{}") or {}
        except (json.JSONDecodeError, TypeError):
            why_meta = {}
        interventions = list(db.query(
            """
            SELECT iv.id, iv.label, iv.metadata_json
            FROM graph_edges e1
            JOIN graph_nodes m  ON m.id = e1.dst AND m.kind = 'mechanism'
            JOIN graph_edges e2 ON e2.src = m.id AND e2.kind = 'addressed_by'
            JOIN graph_nodes iv ON iv.id = e2.dst AND iv.kind = 'intervention'
            WHERE e1.src = :pid AND e1.kind = 'explained_by'
            """,
            {"pid": pp["id"]},
        ))
        if not interventions:
            summary["skipped_painpoints"] += 1
            continue
        result = categorize_interventions_for_painpoint(
            painpoint_label=pp["label"],
            why_meta=why_meta,
            interventions=interventions,
            provider=provider,
        )
        summary["painpoints_processed"] += 1
        if result.get("_skipped") or result.get("_parse_error"):
            continue
        items = result.get("items") or []
        by_id = {it.get("intervention_id"): it for it in items if isinstance(it, dict)}
        for iv in interventions:
            verdict = by_id.get(iv["id"])
            if not verdict:
                continue
            ok = _persist_moscow(
                db,
                intervention_id=iv["id"],
                moscow=str(verdict.get("moscow") or "").strip().lower(),
                confidence=str(verdict.get("confidence") or "med").strip().lower(),
                reasoning=str(verdict.get("reasoning") or "").strip(),
            )
            if ok:
                summary["interventions_categorized"] += 1

    try:
        save_mcp_analysis(
            topic=topic, source="app", kind="moscow",
            tool="run_moscow_categorization",
            content=json.dumps(summary, ensure_ascii=False, default=str),
            content_type="json",
            provider=provider or "", model="", params={},
        )
    except Exception:
        pass
    return summary


__all__ = [
    "VALID_MOSCOW",
    "VALID_CONFIDENCE",
    "categorize_interventions_for_painpoint",
    "categorize_topic",
]
