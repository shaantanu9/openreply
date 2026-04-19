"""Intervention synthesis grounded in fetched papers.

One LLM call per painpoint. Input: painpoint label + why-data + top N
papers. Output: mechanism (1 sentence) + list of 1-3 interventions, each
with a confidence tier and supporting paper IDs.
"""
from __future__ import annotations

import json
from typing import Any

from ..analyze.providers.base import get_provider
from .prompts import load_extractor


def _format_why(why: dict[str, Any]) -> str:
    if not why or why.get("_skipped") or why.get("_parse_error"):
        return "(no why-data available)"
    emotions = ", ".join(why.get("emotions") or []) or "(none)"
    jtbd = why.get("jtbd") or {}
    return (
        f"Emotions: {emotions}\n"
        f"Struggling moment: {jtbd.get('struggling_moment', '?')}\n"
        f"Anxiety: {jtbd.get('anxiety', '?')}\n"
        f"Desired outcome: {jtbd.get('desired_outcome', '?')}"
    )


def _format_papers(papers: list[dict[str, Any]]) -> str:
    parts = []
    for p in papers[:5]:
        abstract = (p.get("selftext") or p.get("abstract") or "")[:600]
        parts.append(
            f"[{p.get('id', '?')}] ({p.get('tier', 'unknown')}) {p.get('title', '')}\n{abstract}"
        )
    return "\n\n".join(parts)


def _parse_json(raw: str) -> dict[str, Any]:
    cleaned = raw.strip()
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


def synthesize_solutions_for_painpoint(
    painpoint_label: str,
    why: dict[str, Any],
    papers: list[dict[str, Any]],
    provider: str | None = None,
) -> dict[str, Any]:
    """Returns either {mechanism, interventions} or {_skipped|_parse_error}."""
    if not papers:
        return {"_skipped": True, "reason": "no_papers"}

    ext = load_extractor("solutions")
    user = ext["user_template"].format(
        painpoint_label=painpoint_label,
        why=_format_why(why),
        papers=_format_papers(papers),
    )
    raw = get_provider(provider).complete(
        prompt=user, system=ext["system"], max_tokens=1200, temperature=0.3
    )
    return _parse_json(raw)
