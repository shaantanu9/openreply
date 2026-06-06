"""SWOT — a strategic 2x2 auto-synthesised from the gap map.

SWOT (Strengths · Weaknesses · Opportunities · Threats) is normally a
brainstorm; here it is grounded in the evidence already mined for the topic:

* **Strengths** + **Opportunities** derive from unmet painpoints and
  feature-wishes — the gap a new product can win by addressing.
* **Weaknesses** + **Threats** derive from incumbent competitors and
  execution risk — what stands in the way of capturing that gap.

The output also names the single ``strategic_note`` — the one SO (use a
strength to seize an opportunity) or WT (shore up a weakness against a
threat) move the 2x2 implies.

Shape (see ``_normalize``)::

    {
      "strengths":     [{"point": str, "why": str}, ...],
      "weaknesses":    [{"point": str, "why": str}, ...],
      "opportunities": [{"point": str, "why": str}, ...],
      "threats":       [{"point": str, "why": str}, ...],
      "strategic_note": str,
    }

Two public functions only:

    swot_get(topic)              -> cached artifact (pure read, never raises)
    swot_compute(topic, prov?)   -> run the LLM synthesis, persist, return it

All LLM / persistence / evidence concerns are delegated to ``strategy_common``.
"""
from __future__ import annotations

from typing import Any

from .strategy_common import (
    context_brief,
    context_is_thin,
    get_artifact,
    put_artifact,
    run_llm_json,
    topic_context,
)


SYSTEM = (
    "You are a rigorous, evidence-grounded product-strategy analyst. "
    "You build a SWOT for a *prospective* new product, derived strictly from "
    "the supplied gap-map evidence (painpoints, feature-wishes, complaints, "
    "workarounds, competitors). Strengths and Opportunities should come from "
    "unmet user needs the new product could win; Weaknesses and Threats from "
    "incumbent competitors and realistic execution risk. Be specific and "
    "concrete — cite the evidence in your 'why' fields rather than generic "
    "platitudes. Never invent facts that the evidence does not support. "
    "Respond with raw JSON only — no prose, no markdown, no code fences."
)

PROMPT = """Synthesise a SWOT for a new product targeting the gap revealed by this evidence.

EVIDENCE:
{evidence}

Return EXACTLY this JSON object and nothing else:

{{
  "strengths": [
    {{"point": "a concrete strength the new product could have", "why": "grounded in the evidence above"}}
  ],
  "weaknesses": [
    {{"point": "a concrete weakness / disadvantage", "why": "grounded in the evidence above"}}
  ],
  "opportunities": [
    {{"point": "an external opportunity (unmet need, market gap)", "why": "grounded in the evidence above"}}
  ],
  "threats": [
    {{"point": "an external threat (competitor, execution risk)", "why": "grounded in the evidence above"}}
  ],
  "strategic_note": "the single most important SO (strength x opportunity) or WT (weakness x threat) move this 2x2 implies"
}}

Rules:
- 2 to 5 items per quadrant. Each item MUST have both "point" and "why" as non-empty strings.
- Strengths/Opportunities lean on unmet painpoints and feature-wishes (the gap to win).
- Weaknesses/Threats lean on competitors and execution risk.
- strategic_note is a single actionable sentence.
- Output raw JSON only."""


def _coerce_items(value: Any, *, cap: int = 8) -> list[dict[str, str]]:
    """Coerce a quadrant into a list of ``{"point", "why"}`` dicts.

    Accepts a list of dicts, a list of strings, or junk — always returns a
    list of well-formed dicts (possibly empty). Never raises.
    """
    out: list[dict[str, str]] = []
    if not isinstance(value, list):
        return out
    for item in value:
        if isinstance(item, dict):
            point = str(item.get("point") or item.get("title") or "").strip()
            why = str(item.get("why") or item.get("reason") or item.get("note") or "").strip()
        elif isinstance(item, str):
            point, why = item.strip(), ""
        else:
            point, why = str(item).strip(), ""
        if not point:
            continue
        out.append({"point": point, "why": why})
        if len(out) >= cap:
            break
    return out


def _normalize(parsed: dict[str, Any]) -> dict[str, Any]:
    """Coerce the raw LLM dict into the documented shape with safe defaults.

    Every quadrant becomes a list of ``{"point", "why"}`` dicts; the
    strategic note becomes a trimmed string. Never raises a ``KeyError``.
    """
    if not isinstance(parsed, dict):
        parsed = {}
    note = parsed.get("strategic_note") or parsed.get("note") or ""
    if not isinstance(note, str):
        note = str(note)
    return {
        "strengths": _coerce_items(parsed.get("strengths")),
        "weaknesses": _coerce_items(parsed.get("weaknesses")),
        "opportunities": _coerce_items(parsed.get("opportunities")),
        "threats": _coerce_items(parsed.get("threats")),
        "strategic_note": note.strip()[:600],
    }


def swot_get(topic: str) -> dict[str, Any]:
    """Pure read of the cached artifact. Never raises."""
    art = get_artifact(topic, "swot")
    if not art:
        return {"topic": topic, "kind": "swot", "computed": False, "data": {}}
    return {"topic": topic, "kind": "swot", "computed": True,
            "data": art["data"], "provider": art["provider"], "updated_at": art["updated_at"]}


def swot_compute(topic: str, provider: str | None = None) -> dict[str, Any]:
    """Run the LLM synthesis for ``topic``, persist it, and return the result.

    Degrades gracefully: returns ``computed: False`` with a ``reason`` when the
    evidence is too thin or no LLM is configured / usable.
    """
    ctx = topic_context(topic)
    if context_is_thin(ctx):
        return {"topic": topic, "kind": "swot", "computed": False,
                "reason": "Not enough evidence yet — collect posts and build the graph for this topic first."}
    parsed, name, model = run_llm_json(
        PROMPT.format(evidence=context_brief(ctx)), SYSTEM,
        provider=provider, max_tokens=1800, temperature=0.3,
    )
    if not parsed:
        return {"topic": topic, "kind": "swot", "computed": False,
                "reason": "No LLM configured, or the model returned no usable JSON. Add an API key in Settings → API keys."}
    data = _normalize(parsed)
    art = put_artifact(topic, "swot", data, provider=name, model=model)
    return {"topic": topic, "kind": "swot", "computed": True,
            "data": data, "provider": name, "updated_at": art["updated_at"]}


__all__ = ["swot_get", "swot_compute"]
