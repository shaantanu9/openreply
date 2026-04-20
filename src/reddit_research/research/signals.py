"""Dual-Mode Pivot — typed product signal constructors.

Every signal the Daily Dashboard surfaces has a type, severity, confidence,
evidence, and a suggested action. See DUAL_MODE_PIVOT.md §4.2 for the six
canonical types. This module is pure — it builds Signal dicts; persistence
lives in product_sweep.py.

Design rules:
- Every signal must carry evidence_post_ids (never >10, for UI scan)
- severity and confidence are 0-1 scalars; combined = severity * confidence
- title is ≤80 chars, description ≤300 chars (UI readability)
- suggested_action is imperative: "Ship fix", "Position against", etc.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable


# ── Canonical signal types ──────────────────────────────────────────────
SIGNAL_TYPES = {
    "competitor_release":      "🚀",
    "chronic_emergence":       "⚠",
    "your_product_regression": "🔻",
    "unmet_need_intensifying": "📈",
    "competitor_vulnerability":"🎯",
    "mention_spike":           "🔊",
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _signal(
    product_id: str,
    signal_type: str,
    title: str,
    severity: float,
    confidence: float,
    description: str = "",
    evidence_post_ids: Iterable[str] = (),
    related_competitor: str = "",
    suggested_action: str = "",
) -> dict[str, Any]:
    """Build one signal dict ready for insert."""
    if signal_type not in SIGNAL_TYPES:
        raise ValueError(f"unknown signal_type: {signal_type}")
    now = _utc_now()
    ev = list(evidence_post_ids)[:10]
    return {
        "id": str(uuid.uuid4()),
        "product_id": product_id,
        "signal_type": signal_type,
        "severity": max(0.0, min(1.0, float(severity))),
        "confidence": max(0.0, min(1.0, float(confidence))),
        "detected_at": now,
        "title": (title or "").strip()[:140],
        "description": (description or "").strip()[:500],
        "evidence_post_ids": json.dumps(ev),
        "related_competitor": related_competitor or "",
        "suggested_action": suggested_action or "",
        "user_action": "",
        "user_action_at": "",
        "snoozed_until": "",
        "resolution_notes": "",
        "created_at": now,
    }


# ── Typed constructors ──────────────────────────────────────────────────
def competitor_release(
    product_id: str,
    competitor: str,
    release_title: str,
    severity: float = 0.6,
    confidence: float = 0.7,
    evidence_post_ids: Iterable[str] = (),
    reception_summary: str = "",
) -> dict:
    """Competitor shipped something. Reception summary = short sentence on
    how users reacted (from reviews / posts)."""
    title = f"{competitor}: {release_title}"
    desc = reception_summary or f"Detected release from {competitor}. Review reactions clustered around {len(list(evidence_post_ids) or [])} posts."
    return _signal(
        product_id=product_id,
        signal_type="competitor_release",
        title=title,
        severity=severity,
        confidence=confidence,
        description=desc,
        evidence_post_ids=evidence_post_ids,
        related_competitor=competitor,
        suggested_action="Position against or consider migration CTA if reception is negative.",
    )


def chronic_emergence(
    product_id: str,
    painpoint: str,
    opportunity_score: float,
    evidence_post_ids: Iterable[str] = (),
    confidence: float = 0.7,
) -> dict:
    """A painpoint crossed the chronic threshold in the category."""
    sev = min(1.0, max(0.3, opportunity_score / 20.0))
    return _signal(
        product_id=product_id,
        signal_type="chronic_emergence",
        title=f"New chronic painpoint: {painpoint}",
        severity=sev,
        confidence=confidence,
        description=f"Opportunity score {opportunity_score:.1f}/20 — crossed the chronic threshold in the category corpus.",
        evidence_post_ids=evidence_post_ids,
        suggested_action="Add to roadmap; consider a cheapest-test hypothesis to validate.",
    )


def your_product_regression(
    product_id: str,
    complaint_cluster: str,
    mentions_delta_pct: float,
    evidence_post_ids: Iterable[str] = (),
    confidence: float = 0.85,
) -> dict:
    """Your product is being complained about more — velocity spike."""
    sev = min(1.0, max(0.5, abs(mentions_delta_pct) / 100.0))
    return _signal(
        product_id=product_id,
        signal_type="your_product_regression",
        title=f"Regression: {complaint_cluster}",
        severity=sev,
        confidence=confidence,
        description=f"Mentions +{mentions_delta_pct:.0f}% WoW clustered on '{complaint_cluster}'. Your product is being complained about above baseline.",
        evidence_post_ids=evidence_post_ids,
        suggested_action="Immediate engineering attention — classify severity and hotfix candidate.",
    )


def unmet_need_intensifying(
    product_id: str,
    need: str,
    prev_score: float,
    curr_score: float,
    evidence_post_ids: Iterable[str] = (),
    confidence: float = 0.75,
) -> dict:
    """An existing unmet need's Ulwick score jumped."""
    delta = curr_score - prev_score
    sev = min(1.0, max(0.3, delta / 10.0))
    return _signal(
        product_id=product_id,
        signal_type="unmet_need_intensifying",
        title=f"Opportunity rising: {need}",
        severity=sev,
        confidence=confidence,
        description=f"Opportunity score moved {prev_score:.1f} → {curr_score:.1f} (+{delta:.1f}). Demand is intensifying.",
        evidence_post_ids=evidence_post_ids,
        suggested_action="Prioritize in next planning cycle; consider as next bet.",
    )


def competitor_vulnerability(
    product_id: str,
    competitor: str,
    weakness: str,
    sentiment_hint: str = "",
    evidence_post_ids: Iterable[str] = (),
    severity: float = 0.5,
    confidence: float = 0.65,
) -> dict:
    """A competitor is being criticized on a specific axis — positioning
    opportunity."""
    desc = f"{competitor}: users complain about '{weakness}'."
    if sentiment_hint:
        desc += f" {sentiment_hint}"
    return _signal(
        product_id=product_id,
        signal_type="competitor_vulnerability",
        title=f"{competitor} weak on: {weakness}",
        severity=severity,
        confidence=confidence,
        description=desc,
        evidence_post_ids=evidence_post_ids,
        related_competitor=competitor,
        suggested_action="Run a positioning/comparison campaign if it matches your strength.",
    )


def mention_spike(
    product_id: str,
    entity: str,
    multiplier: float,
    source: str,
    evidence_post_ids: Iterable[str] = (),
    confidence: float = 0.8,
) -> dict:
    """Your product or a competitor is mentioned way above baseline."""
    sev = min(1.0, max(0.2, (multiplier - 1.0) / 5.0))
    return _signal(
        product_id=product_id,
        signal_type="mention_spike",
        title=f"{entity} mention spike ({multiplier:.1f}×)",
        severity=sev,
        confidence=confidence,
        description=f"{entity} mentioned {multiplier:.1f}× normal rate on {source}. Check the thread for context.",
        evidence_post_ids=evidence_post_ids,
        related_competitor=entity,
        suggested_action="Check the thread; reply or monitor as appropriate.",
    )


__all__ = [
    "SIGNAL_TYPES",
    "competitor_release",
    "chronic_emergence",
    "your_product_regression",
    "unmet_need_intensifying",
    "competitor_vulnerability",
    "mention_spike",
]
