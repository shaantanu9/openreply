"""Root Cause (5 Whys) — drill each top painpoint down to its addressable root.

The gap map surfaces *symptoms* (painpoints, complaints) but a good product is
built by addressing the *cause* underneath them. This module runs the classic
"5 Whys" technique — ground in the evidence already mined for the topic, take
the top 3-5 painpoints, and for each one ask "why?" five times until a root
cause emerges, then name the single addressable intervention that root implies.

Shape (see ``_normalize``)::

    {
      "analyses": [
        {
          "painpoint":       str,
          "whys":            list[str],   # up to 5 ladder rungs
          "root_cause":      str,
          "addressable":     bool,        # can a new product realistically fix it?
          "suggested_focus": str          # the intervention the root implies
        }, ...
      ],
      "summary": str   # the dominant root cause across all painpoints
    }

Two public functions only:

    root_cause_get(topic)             -> cached artifact (pure read, never raises)
    root_cause_compute(topic, prov?)  -> run the LLM synthesis, persist, return it

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
    "You are a rigorous, evidence-grounded product-strategy analyst applying the "
    "'5 Whys' root-cause technique. You take the dominant user painpoints from the "
    "supplied gap-map evidence and, for each one, ask 'why does this happen?' "
    "repeatedly (up to five times) until you reach an underlying root cause rather "
    "than a surface symptom. Each 'why' answer must build on the previous one — a "
    "true causal ladder, not five restatements. Then judge whether a new product "
    "could realistically address that root, and name the single most promising "
    "intervention it implies. Ground every step strictly in the evidence; never "
    "invent facts. Respond with raw JSON only — no prose, no markdown, no code fences."
)

PROMPT = """Run a 5-Whys root-cause analysis on the dominant painpoints in this evidence.

EVIDENCE:
{evidence}

Return EXACTLY this JSON object and nothing else:

{{
  "analyses": [
    {{
      "painpoint": "one of the top painpoints from the evidence",
      "whys": [
        "Why does this happen? -> first-level cause",
        "Why does THAT happen? -> deeper cause",
        "Why? -> deeper still",
        "Why? -> deeper still",
        "Why? -> the underlying root"
      ],
      "root_cause": "the single underlying root cause the ladder arrives at",
      "addressable": true,
      "suggested_focus": "the one intervention a new product could build to address this root"
    }}
  ],
  "summary": "the dominant root cause that recurs across these painpoints"
}}

Rules:
- Analyse the top 3 to 5 painpoints — pick the ones with the strongest evidence.
- Each "whys" array has up to 5 rungs; each rung is a non-empty string that goes
  one level deeper than the previous (a real causal chain, not a restatement).
- "root_cause" is the bottom of the ladder; "suggested_focus" is the addressable
  intervention it implies.
- "addressable" is a boolean: true if a new product could realistically fix the
  root, false if it is structural / outside a product's control.
- "summary" is a single sentence naming the dominant cross-cutting root cause.
- Output raw JSON only."""


def _clamp_whys(value: Any, *, cap: int = 5) -> list[str]:
    """Coerce the whys field into a clean ``list[str]`` of at most ``cap`` rungs.

    Accepts a list, a single string, or junk — always returns a list of
    non-empty trimmed strings, padded/truncated to ``<= cap``. Never raises.
    """
    if isinstance(value, str):
        items = [value]
    elif isinstance(value, list):
        items = value
    else:
        items = []
    out: list[str] = []
    for item in items:
        s = str(item).strip() if item is not None else ""
        if s:
            out.append(s)
        if len(out) >= cap:
            break
    return out


def _coerce_analysis(value: Any) -> dict[str, Any] | None:
    """Coerce one raw analysis entry into the documented shape, or ``None``.

    Returns ``None`` when the entry has no painpoint to anchor on. Never raises.
    """
    if not isinstance(value, dict):
        return None
    painpoint = str(value.get("painpoint") or value.get("symptom") or "").strip()
    if not painpoint:
        return None
    root = value.get("root_cause") or value.get("root") or value.get("cause") or ""
    focus = value.get("suggested_focus") or value.get("focus") or value.get("intervention") or ""
    return {
        "painpoint": painpoint[:400],
        "whys": _clamp_whys(value.get("whys") or value.get("ladder")),
        "root_cause": str(root).strip()[:600],
        "addressable": bool(value.get("addressable", False)),
        "suggested_focus": str(focus).strip()[:600],
    }


def _normalize(parsed: dict[str, Any]) -> dict[str, Any]:
    """Coerce the raw LLM dict into the documented shape with safe defaults.

    ``analyses`` becomes a list of well-formed dicts (each with a clamped whys
    list and a boolean ``addressable``); ``summary`` becomes a trimmed string.
    Never raises a ``KeyError``.
    """
    if not isinstance(parsed, dict):
        parsed = {}
    raw = parsed.get("analyses")
    analyses: list[dict[str, Any]] = []
    if isinstance(raw, list):
        for entry in raw:
            coerced = _coerce_analysis(entry)
            if coerced is not None:
                analyses.append(coerced)
            if len(analyses) >= 5:
                break
    summary = parsed.get("summary") or parsed.get("note") or ""
    if not isinstance(summary, str):
        summary = str(summary)
    return {"analyses": analyses, "summary": summary.strip()[:600]}


def root_cause_get(topic: str) -> dict[str, Any]:
    """Pure read of the cached artifact. Never raises."""
    art = get_artifact(topic, "root_cause")
    if not art:
        return {"topic": topic, "kind": "root_cause", "computed": False, "data": {}}
    return {"topic": topic, "kind": "root_cause", "computed": True,
            "data": art["data"], "provider": art["provider"], "updated_at": art["updated_at"]}


def root_cause_compute(topic: str, provider: str | None = None) -> dict[str, Any]:
    """Run the 5-Whys LLM synthesis for ``topic``, persist it, and return it.

    Degrades gracefully: returns ``computed: False`` with a ``reason`` when the
    evidence is too thin or no LLM is configured / usable.
    """
    ctx = topic_context(topic)
    if context_is_thin(ctx):
        return {"topic": topic, "kind": "root_cause", "computed": False,
                "reason": "Not enough evidence yet — collect posts and build the graph for this topic first."}
    parsed, name, model = run_llm_json(
        PROMPT.format(evidence=context_brief(ctx)), SYSTEM,
        provider=provider, max_tokens=1900, temperature=0.3,
    )
    if not parsed:
        return {"topic": topic, "kind": "root_cause", "computed": False,
                "reason": "No LLM configured, or the model returned no usable JSON. Add an API key in Settings → API keys."}
    data = _normalize(parsed)
    art = put_artifact(topic, "root_cause", data, provider=name, model=model)
    return {"topic": topic, "kind": "root_cause", "computed": True,
            "data": data, "provider": name, "updated_at": art["updated_at"]}


__all__ = ["root_cause_get", "root_cause_compute"]
