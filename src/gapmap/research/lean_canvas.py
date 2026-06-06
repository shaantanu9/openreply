"""Lean Canvas (Ash Maurya, 2010 — adaptation of the Business Model Canvas).

One topic-keyed artifact in the shared ``strategy_artifacts`` table. The nine
Lean Canvas blocks are synthesised by a single evidence-grounded LLM pass over
the topic's painpoints / feature-wishes / competitors / complaints (gathered by
``strategy_common.topic_context``). The blocks are:

    problem, existing_alternatives, solution, unique_value_proposition,
    high_level_concept, unfair_advantage, customer_segments, early_adopters,
    channels, cost_structure, revenue_streams, key_metrics.

Like the other strategy modules:

    lean_canvas_get(topic)            -> cached artifact (pure read, never raises)
    lean_canvas_compute(topic, ...)   -> run the LLM synthesis, persist, return it

All LLM, persistence and evidence concerns are delegated to
``strategy_common``; this module only owns the prompt and the defensive
normaliser that coerces whatever the model returns into the documented shape.
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
    "You are a seasoned product strategist and startup advisor who builds Lean "
    "Canvases (Ash Maurya's method) strictly from real user evidence. You are "
    "given a distilled bundle of painpoints, feature wishes, complaints, "
    "workarounds and competing products mined from real discussions about a "
    "topic. Synthesise a sharp, opinionated, evidence-grounded Lean Canvas. "
    "Ground every block in the supplied evidence — do not invent markets, "
    "competitors or features that the evidence does not support. Be concrete and "
    "concise; favour specific phrasing over generic startup boilerplate. "
    "Return ONLY a single raw JSON object that matches the requested schema "
    "exactly — no prose, no explanation, and no markdown code fences."
)

PROMPT = (
    "Build a Lean Canvas for the product opportunity described by the evidence "
    "below.\n\n"
    "EVIDENCE:\n{evidence}\n\n"
    "Return ONLY a raw JSON object with EXACTLY these keys (no others):\n"
    "{{\n"
    '  "problem": ["the top 1-3 problems users actually have"],\n'
    '  "existing_alternatives": ["how users solve this today (tools, workarounds, '
    'competitors)"],\n'
    '  "solution": ["the top features that solve the listed problems"],\n'
    '  "unique_value_proposition": "a single clear, compelling, differentiated '
    'message",\n'
    '  "high_level_concept": "an X-for-Y analogy (e.g. \\"Notion for runners\\")",\n'
    '  "unfair_advantage": "something that cannot be easily copied or bought",\n'
    '  "customer_segments": ["the target customer segments"],\n'
    '  "early_adopters": "the characteristics of the ideal first users",\n'
    '  "channels": ["paths to reach customers"],\n'
    '  "cost_structure": ["the main costs to build and run this"],\n'
    '  "revenue_streams": ["how this makes money"],\n'
    '  "key_metrics": ["the few numbers that matter most"]\n'
    "}}\n\n"
    "Rules: list fields are arrays of short strings (1-3 items for problem; up to "
    "5 for the rest). String fields are a single concise sentence. Keep every "
    "block grounded in the evidence. Output the JSON object and nothing else."
)


def _as_str(value: Any, *, max_len: int = 600) -> str:
    """Coerce any value to a trimmed string (never raises)."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()[:max_len]
    if isinstance(value, (list, tuple)):
        # Join list-shaped values that belong in a string field.
        return ", ".join(_as_str(v, max_len=max_len) for v in value if v is not None).strip()[:max_len]
    return str(value).strip()[:max_len]


def _as_str_list(value: Any, *, cap: int = 8, max_len: int = 300) -> list[str]:
    """Coerce any value to a list of non-empty trimmed strings (never raises)."""
    items: list[Any]
    if value is None:
        items = []
    elif isinstance(value, (list, tuple)):
        items = list(value)
    elif isinstance(value, str):
        # A model that returns a bullet/newline string instead of an array.
        raw = value.replace("\r", "\n")
        parts = [p for chunk in raw.split("\n") for p in chunk.split("•")]
        items = parts if len(parts) > 1 else [value]
    else:
        items = [value]
    out: list[str] = []
    seen: set[str] = set()
    for it in items:
        s = _as_str(it, max_len=max_len).lstrip("-•* ").strip()
        if s and s.lower() not in seen:
            out.append(s)
            seen.add(s.lower())
        if len(out) >= cap:
            break
    return out


def _normalize(parsed: dict[str, Any]) -> dict[str, Any]:
    """Coerce raw LLM output into the documented Lean Canvas shape.

    Every field is forced to its documented type with a safe default; missing or
    mis-typed keys never raise. List fields become lists of clean strings; the
    free-text fields become single trimmed strings.
    """
    p = parsed if isinstance(parsed, dict) else {}
    return {
        "problem": _as_str_list(p.get("problem"), cap=3),
        "existing_alternatives": _as_str_list(p.get("existing_alternatives")),
        "solution": _as_str_list(p.get("solution")),
        "unique_value_proposition": _as_str(p.get("unique_value_proposition")),
        "high_level_concept": _as_str(p.get("high_level_concept")),
        "unfair_advantage": _as_str(p.get("unfair_advantage")),
        "customer_segments": _as_str_list(p.get("customer_segments")),
        "early_adopters": _as_str(p.get("early_adopters")),
        "channels": _as_str_list(p.get("channels")),
        "cost_structure": _as_str_list(p.get("cost_structure")),
        "revenue_streams": _as_str_list(p.get("revenue_streams")),
        "key_metrics": _as_str_list(p.get("key_metrics")),
    }


def lean_canvas_get(topic: str) -> dict[str, Any]:
    """Pure read of the cached artifact. Never raises."""
    art = get_artifact(topic, "lean_canvas")
    if not art:
        return {"topic": topic, "kind": "lean_canvas", "computed": False, "data": {}}
    return {"topic": topic, "kind": "lean_canvas", "computed": True,
            "data": art["data"], "provider": art["provider"], "updated_at": art["updated_at"]}


def lean_canvas_compute(topic: str, provider: str | None = None) -> dict[str, Any]:
    """Synthesise the Lean Canvas via one LLM pass, persist, and return it."""
    ctx = topic_context(topic)
    if context_is_thin(ctx):
        return {"topic": topic, "kind": "lean_canvas", "computed": False,
                "reason": "Not enough evidence yet — collect posts and build the graph for this topic first."}
    parsed, name, model = run_llm_json(
        PROMPT.format(evidence=context_brief(ctx)), SYSTEM,
        provider=provider, max_tokens=1800, temperature=0.3,
    )
    if not parsed:
        return {"topic": topic, "kind": "lean_canvas", "computed": False,
                "reason": "No LLM configured, or the model returned no usable JSON. Add an API key in Settings → API keys."}
    data = _normalize(parsed)
    art = put_artifact(topic, "lean_canvas", data, provider=name, model=model)
    return {"topic": topic, "kind": "lean_canvas", "computed": True,
            "data": data, "provider": name, "updated_at": art["updated_at"]}


__all__ = ["lean_canvas_get", "lean_canvas_compute"]
