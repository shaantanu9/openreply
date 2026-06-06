"""North-Star Metric framework (pre-build product strategy).

For a chosen opportunity we propose the ONE metric that best captures the
value the product delivers — the North-Star metric (NSM) — together with the
input metrics that move it, early leading indicators, and the vanity /
anti-metrics teams should deliberately NOT optimise.

Shape of ``data`` (what the screen renders)::

    {
      "north_star_metric": "the one metric",
      "definition": "precisely how it's measured",
      "why": "why it captures delivered value",
      "input_metrics": [{"name": "...", "why": "a lever that moves the NSM"}],
      "leading_indicators": ["early signals"],
      "anti_metrics": ["vanity metrics to NOT optimise"],
      "rationale": "tie back to the painpoints this product solves"
    }

Follows the shared strategy-module contract:

    north_star_get(topic)              -> cached artifact (pure read, never raises)
    north_star_compute(topic, provider)-> run the LLM synthesis, persist, return it

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
    "You are a senior product-strategy analyst defining the North-Star metric "
    "for a pre-build product. You reason ONLY from the supplied evidence "
    "(painpoints, feature wishes, complaints, workarounds, competitors). "
    "You pick the ONE metric that best measures the value the product delivers "
    "to users — not a vanity number — and you name the input metrics that "
    "actually move it. Be concrete, measurable, and grounded in the painpoints. "
    "Respond with a SINGLE raw JSON object and nothing else: no markdown, no "
    "code fences, no prose before or after."
)

PROMPT = (
    "Using only the evidence below, define the North-Star metric for this "
    "opportunity.\n\n"
    "EVIDENCE\n"
    "========\n"
    "{evidence}\n\n"
    "Return EXACTLY this JSON shape (raw JSON, no fences):\n"
    "{{\n"
    '  "north_star_metric": "the single metric, short and concrete",\n'
    '  "definition": "precisely how it is measured (numerator/denominator, '
    'cadence, unit)",\n'
    '  "why": "why this metric captures the value actually delivered to users",\n'
    '  "input_metrics": [\n'
    '    {{"name": "input metric name", "why": "the lever it pulls that moves '
    'the NSM"}}\n'
    "  ],\n"
    '  "leading_indicators": ["early signals that predict the NSM will move"],\n'
    '  "anti_metrics": ["vanity metrics the team must NOT optimise for"],\n'
    '  "rationale": "tie the choice back to the specific painpoints this '
    'product solves"\n'
    "}}\n\n"
    "Rules: ONE north-star metric only. 3-6 input metrics, each a real lever. "
    "3-6 leading indicators. 2-5 anti-metrics. Ground every choice in the "
    "evidence above. Output raw JSON only."
)


def _as_str(value: Any, default: str = "") -> str:
    """Coerce a value to a clean string with a safe default."""
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    try:
        return str(value).strip()
    except Exception:
        return default


def _as_str_list(value: Any, *, cap: int = 12) -> list[str]:
    """Coerce a value to a list of non-empty strings, capped."""
    if value is None:
        return []
    if isinstance(value, str):
        s = value.strip()
        return [s] if s else []
    if isinstance(value, dict):
        value = list(value.values())
    if not isinstance(value, (list, tuple, set)):
        return []
    out: list[str] = []
    for item in value:
        s = _as_str(item)
        if s and s not in out:
            out.append(s)
        if len(out) >= cap:
            break
    return out


def _as_input_metrics(value: Any, *, cap: int = 10) -> list[dict[str, str]]:
    """Coerce a value to ``[{"name": str, "why": str}, ...]`` defensively.

    Tolerates a list of strings, a list of dicts with assorted key names, a
    bare dict, or junk — always returns well-formed list elements.
    """
    if value is None:
        return []
    if isinstance(value, dict):
        value = [value]
    if isinstance(value, str):
        s = value.strip()
        return [{"name": s, "why": ""}] if s else []
    if not isinstance(value, (list, tuple, set)):
        return []
    out: list[dict[str, str]] = []
    for item in value:
        if isinstance(item, dict):
            name = _as_str(
                item.get("name")
                or item.get("metric")
                or item.get("title")
                or item.get("input")
            )
            why = _as_str(
                item.get("why")
                or item.get("reason")
                or item.get("lever")
                or item.get("description")
            )
        else:
            name = _as_str(item)
            why = ""
        if name:
            out.append({"name": name, "why": why})
        if len(out) >= cap:
            break
    return out


def _normalize(parsed: dict[str, Any]) -> dict[str, Any]:
    """Coerce the raw LLM JSON into the documented shape with safe defaults.

    Never raises / never KeyErrors. Every field is forced to its documented
    type; list fields become lists of the right element shape.
    """
    src = parsed if isinstance(parsed, dict) else {}
    return {
        "north_star_metric": _as_str(src.get("north_star_metric")),
        "definition": _as_str(src.get("definition")),
        "why": _as_str(src.get("why")),
        "input_metrics": _as_input_metrics(src.get("input_metrics")),
        "leading_indicators": _as_str_list(src.get("leading_indicators")),
        "anti_metrics": _as_str_list(src.get("anti_metrics")),
        "rationale": _as_str(src.get("rationale")),
    }


def north_star_get(topic: str) -> dict[str, Any]:
    """Pure read of the cached artifact. Never raises."""
    art = get_artifact(topic, "north_star")
    if not art:
        return {"topic": topic, "kind": "north_star", "computed": False, "data": {}}
    return {
        "topic": topic,
        "kind": "north_star",
        "computed": True,
        "data": art["data"],
        "provider": art["provider"],
        "updated_at": art["updated_at"],
    }


def north_star_compute(topic: str, provider: str | None = None) -> dict[str, Any]:
    """Run the LLM synthesis, persist, and return the North-Star artifact."""
    ctx = topic_context(topic)
    if context_is_thin(ctx):
        return {
            "topic": topic,
            "kind": "north_star",
            "computed": False,
            "reason": "Not enough evidence yet — collect posts and build the "
            "graph for this topic first.",
        }
    parsed, name, model = run_llm_json(
        PROMPT.format(evidence=context_brief(ctx)),
        SYSTEM,
        provider=provider,
        max_tokens=1800,
        temperature=0.3,
    )
    if not parsed:
        return {
            "topic": topic,
            "kind": "north_star",
            "computed": False,
            "reason": "No LLM configured, or the model returned no usable JSON. "
            "Add an API key in Settings → API keys.",
        }
    data = _normalize(parsed)
    art = put_artifact(topic, "north_star", data, provider=name, model=model)
    return {
        "topic": topic,
        "kind": "north_star",
        "computed": True,
        "data": data,
        "provider": name,
        "updated_at": art["updated_at"],
    }


__all__ = ["north_star_get", "north_star_compute"]
