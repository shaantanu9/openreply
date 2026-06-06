"""TAM / SAM / SOM market sizing + market-value anchoring.

A pre-build strategy framework: grounded in the topic's corpus evidence, the
LLM produces a defensible market estimate combining

* **top-down** sizing (industry $ × relevant segment), and
* **bottom-up** sizing (reachable users × price),

then nests them as TAM ⊃ SAM ⊃ SOM, with explicit assumptions, comparable
companies/products, a market-value note (what the category is worth / who the
big players are), and a calibrated confidence chip.

Like every strategy module it exposes two public functions:

    market_sizing_get(topic)              -> cached artifact (pure read, never raises)
    market_sizing_compute(topic, provider) -> run the LLM, persist, return it

All LLM, persistence, and evidence concerns are delegated to
``strategy_common``; this module only owns the prompt and the defensive
normalisation of the model's JSON into the documented data shape.
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

KIND = "market_sizing"


SYSTEM = (
    "You are a rigorous, evidence-grounded product-strategy and market analyst. "
    "You estimate market size for a prospective product using BOTH a top-down "
    "method (total industry revenue × the share relevant to this product's "
    "segment) AND a bottom-up method (reachable users × realistic annual price), "
    "then reconcile them into TAM (total addressable market), SAM (serviceable "
    "addressable market), and SOM (serviceable obtainable market — what a focused "
    "new entrant could realistically capture in 3 years). "
    "Ground every number in the provided evidence and in widely-known public "
    "market facts; never invent precise figures you cannot defend. When a figure "
    "is genuinely unknowable, set its value_usd to null and explain why in the "
    "basis. Be conservative: SOM must be much smaller than SAM, and SAM smaller "
    "than TAM. Calibrate confidence honestly — thin evidence or speculative "
    "comparables mean 'low'. "
    "Return ONLY a single raw JSON object. No prose, no markdown, no code fences."
)


PROMPT = (
    "Estimate the market for a product addressing the demand revealed in the "
    "evidence below. Use a top-down + bottom-up method and reconcile them.\n\n"
    "EVIDENCE:\n{evidence}\n\n"
    "Return EXACTLY this JSON shape (and nothing else):\n"
    "{{\n"
    '  "tam": {{"value_usd": number|null, "label": "$X.YB", "basis": "how derived (top-down: industry $ x segment %)"}},\n'
    '  "sam": {{"value_usd": number|null, "label": "$X.YM", "basis": "the serviceable slice and why"}},\n'
    '  "som": {{"value_usd": number|null, "label": "$X.YM", "basis": "bottom-up: reachable users x price, 3yr obtainable"}},\n'
    '  "currency": "USD",\n'
    '  "cagr_pct": number|null,\n'
    '  "method": "top-down + bottom-up",\n'
    '  "assumptions": ["each key assumption behind the numbers"],\n'
    '  "comparables": [{{"name": "company/product", "signal": "revenue/funding/users note"}}],\n'
    '  "market_value_note": "what the category is worth overall and who the big players are",\n'
    '  "confidence": "low|medium|high",\n'
    '  "confidence_reason": "why this confidence level given the evidence depth"\n'
    "}}\n\n"
    "Rules: value_usd is a raw number in USD (e.g. 4500000000 for $4.5B), or null "
    "if undefinable. label is a short human string like \"$4.5B\". Keep TAM > SAM > "
    "SOM. cagr_pct is a percentage number (e.g. 12.5) or null. Provide 3-6 "
    "assumptions and 2-5 comparables. Output raw JSON only."
)


# ── normalisation ────────────────────────────────────────────────────────────

_CONFIDENCE_VALUES = ("low", "medium", "high")


def _as_str(v: Any, default: str = "") -> str:
    if v is None:
        return default
    if isinstance(v, str):
        return v.strip()
    return str(v)


def _as_num_or_none(v: Any) -> float | int | None:
    """Coerce to a number, or None. Accepts numeric strings like '4.5e9'."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        s = v.strip().replace(",", "").replace("$", "")
        if not s:
            return None
        try:
            f = float(s)
            return int(f) if f.is_integer() else f
        except Exception:
            return None
    return None


def _norm_tier(raw: Any) -> dict[str, Any]:
    """Coerce a TAM/SAM/SOM tier to {value_usd, label, basis}."""
    d = raw if isinstance(raw, dict) else {}
    return {
        "value_usd": _as_num_or_none(d.get("value_usd")),
        "label": _as_str(d.get("label")),
        "basis": _as_str(d.get("basis")),
    }


def _norm_comparables(raw: Any) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    if not isinstance(raw, list):
        return out
    for item in raw:
        if isinstance(item, dict):
            name = _as_str(item.get("name"))
            signal = _as_str(item.get("signal"))
        else:
            name = _as_str(item)
            signal = ""
        if name or signal:
            out.append({"name": name, "signal": signal})
    return out


def _norm_str_list(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [_as_str(x) for x in raw if _as_str(x)]


def _norm_confidence(raw: Any) -> str:
    s = _as_str(raw).lower()
    return s if s in _CONFIDENCE_VALUES else "low"


def _norm_cagr(raw: Any) -> float | int | None:
    n = _as_num_or_none(raw)
    if n is None:
        return None
    # Clamp to a sane percentage range; growth beyond this is almost certainly
    # a model error (e.g. expressing a ratio instead of a percentage).
    if n < 0:
        return 0
    if n > 200:
        return 200
    return n


def _normalize(parsed: dict[str, Any]) -> dict[str, Any]:
    """Coerce the LLM output into the documented shape with safe defaults.

    Never raises / never KeyErrors: missing fields become empty defaults,
    numeric fields are clamped to their valid ranges, and list fields are
    normalised to lists of the right element shape.
    """
    p = parsed if isinstance(parsed, dict) else {}
    return {
        "tam": _norm_tier(p.get("tam")),
        "sam": _norm_tier(p.get("sam")),
        "som": _norm_tier(p.get("som")),
        "currency": _as_str(p.get("currency"), "USD") or "USD",
        "cagr_pct": _norm_cagr(p.get("cagr_pct")),
        "method": _as_str(p.get("method"), "top-down + bottom-up")
        or "top-down + bottom-up",
        "assumptions": _norm_str_list(p.get("assumptions")),
        "comparables": _norm_comparables(p.get("comparables")),
        "market_value_note": _as_str(p.get("market_value_note")),
        "confidence": _norm_confidence(p.get("confidence")),
        "confidence_reason": _as_str(p.get("confidence_reason")),
    }


# ── public API ───────────────────────────────────────────────────────────────

def market_sizing_get(topic: str) -> dict[str, Any]:
    """Pure read of the cached artifact. Never raises."""
    art = get_artifact(topic, KIND)
    if not art:
        return {"topic": topic, "kind": KIND, "computed": False, "data": {}}
    return {
        "topic": topic,
        "kind": KIND,
        "computed": True,
        "data": art["data"],
        "provider": art["provider"],
        "updated_at": art["updated_at"],
    }


def market_sizing_compute(topic: str, provider: str | None = None) -> dict[str, Any]:
    """Run the LLM market-sizing synthesis, persist it, and return it.

    Degrades gracefully: thin evidence or no configured LLM yields a
    ``computed: False`` result with a human-readable ``reason`` instead of
    raising.
    """
    ctx = topic_context(topic)
    if context_is_thin(ctx):
        return {
            "topic": topic,
            "kind": KIND,
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
            "kind": KIND,
            "computed": False,
            "reason": "No LLM configured, or the model returned no usable JSON. "
            "Add an API key in Settings → API keys.",
        }
    data = _normalize(parsed)
    art = put_artifact(topic, KIND, data, provider=name, model=model)
    return {
        "topic": topic,
        "kind": KIND,
        "computed": True,
        "data": data,
        "provider": name,
        "updated_at": art["updated_at"],
    }


__all__ = ["market_sizing_get", "market_sizing_compute"]
