"""Porter's Five Forces — structural attractiveness of the market.

Michael Porter's classic framework rates the five competitive forces that
determine how attractive (i.e. profitable / enterable) an industry is:

    competitive_rivalry   — how fierce is head-to-head competition?
    threat_new_entrants   — how easily can new players enter?
    threat_substitutes    — how readily can buyers switch to alternatives?
    buyer_power           — how much leverage do customers hold?
    supplier_power        — how much leverage do suppliers hold?

Each force is scored 1–5 where **1 = weak force (favourable for a new
entrant)** and **5 = strong force (hostile)**. The overall verdict rolls
those up into a low/moderate/high attractiveness call.

The analysis is grounded in the topic's evidence bundle (painpoints,
feature-wishes, complaints, workarounds, competitors/products, corpus
size + source mix) gathered by ``strategy_common.topic_context`` — never
invented. Persistence, provider resolution and tolerant JSON parsing all
live in ``strategy_common``.

Public contract (mirrors every other strategy module):

    porter_get(topic)             -> cached artifact dict (pure read, never raises)
    porter_compute(topic, prov)   -> run the LLM synthesis, persist, return it
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

# ── prompt constants (module-level, import-safe, no side effects) ─────────────

SYSTEM = (
    "You are a rigorous product-strategy analyst applying Porter's Five Forces "
    "to decide whether a market is structurally attractive to ENTER as a new "
    "product. You reason ONLY from the supplied evidence (real user painpoints, "
    "feature wishes, complaints, workarounds, and competitors mined from "
    "community posts) — never invent facts not implied by it. Be decisive but "
    "honest about uncertainty when evidence is thin.\n\n"
    "Scoring convention is CRITICAL: each force is scored 1–5 where 1 = a WEAK "
    "force (favourable for a new entrant — easy to win) and 5 = a STRONG force "
    "(hostile — hard to win). The level label must match the score: 1–2 = "
    "'low', 3 = 'moderate', 4–5 = 'high'. overall_attractiveness is the "
    "inverse intuition: mostly weak forces => 'high' attractiveness; mostly "
    "strong forces => 'low' attractiveness.\n\n"
    "Output STRICT, RAW JSON ONLY — no markdown, no code fences, no commentary "
    "before or after. Every rationale must cite or paraphrase the evidence; "
    "every evidence array must hold short concrete strings drawn from the "
    "supplied bundle."
)

PROMPT = (
    "Analyse the market below with Porter's Five Forces, grounded strictly in "
    "this evidence:\n\n"
    "{evidence}\n\n"
    "Return RAW JSON with EXACTLY this shape (no extra keys, no fences):\n"
    "{{\n"
    '  "forces": {{\n'
    '    "competitive_rivalry": {{"score": <1-5 int>, "level": "low|moderate|high", "rationale": "<why, grounded in evidence>", "evidence": ["<short concrete signal>", "..."]}},\n'
    '    "threat_new_entrants": {{"score": <1-5 int>, "level": "low|moderate|high", "rationale": "...", "evidence": ["..."]}},\n'
    '    "threat_substitutes": {{"score": <1-5 int>, "level": "low|moderate|high", "rationale": "...", "evidence": ["..."]}},\n'
    '    "buyer_power": {{"score": <1-5 int>, "level": "low|moderate|high", "rationale": "...", "evidence": ["..."]}},\n'
    '    "supplier_power": {{"score": <1-5 int>, "level": "low|moderate|high", "rationale": "...", "evidence": ["..."]}}\n'
    "  }},\n"
    '  "overall_attractiveness": "low|moderate|high",\n'
    '  "summary": "<1-2 sentences: is this a structurally attractive market to enter and why>"\n'
    "}}\n\n"
    "Remember: score 1 = weak/favourable force, 5 = strong/hostile force. "
    "Workarounds and unmet feature wishes suggest weak substitutes and weak "
    "rivalry (opportunity); a crowded competitor list suggests strong rivalry."
)

# ── force keys & defaults ─────────────────────────────────────────────────────

_FORCE_KEYS = (
    "competitive_rivalry",
    "threat_new_entrants",
    "threat_substitutes",
    "buyer_power",
    "supplier_power",
)
_LEVELS = ("low", "moderate", "high")
_ATTRACTIVENESS = ("low", "moderate", "high")


def _clamp_score(value: Any) -> int:
    """Coerce to an int in [1, 5]; default 3 (moderate) when unusable."""
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        return 3
    if n < 1:
        return 1
    if n > 5:
        return 5
    return n


def _level_for_score(score: int) -> str:
    if score <= 2:
        return "low"
    if score == 3:
        return "moderate"
    return "high"


def _coerce_level(value: Any, score: int) -> str:
    """Use the supplied level if valid, else derive it from the score."""
    s = str(value or "").strip().lower()
    if s in _LEVELS:
        return s
    return _level_for_score(score)


def _coerce_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _coerce_str_list(value: Any, *, cap: int = 8) -> list[str]:
    """Coerce any input into a clean list of non-empty short strings."""
    if value is None:
        return []
    if isinstance(value, str):
        items = [value]
    elif isinstance(value, (list, tuple)):
        items = list(value)
    else:
        items = [value]
    out: list[str] = []
    for it in items:
        s = _coerce_str(it)
        if s and s not in out:
            out.append(s)
        if len(out) >= cap:
            break
    return out


def _coerce_force(raw: Any) -> dict[str, Any]:
    """Coerce one force dict to {score, level, rationale, evidence}."""
    d = raw if isinstance(raw, dict) else {}
    score = _clamp_score(d.get("score"))
    return {
        "score": score,
        "level": _coerce_level(d.get("level"), score),
        "rationale": _coerce_str(d.get("rationale")),
        "evidence": _coerce_str_list(d.get("evidence")),
    }


def _coerce_attractiveness(value: Any) -> str:
    s = str(value or "").strip().lower()
    return s if s in _ATTRACTIVENESS else "moderate"


def _normalize(parsed: dict[str, Any]) -> dict[str, Any]:
    """Coerce the LLM payload into the documented shape with safe defaults.

    Never raises / never KeyErrors: missing forces fall back to a moderate
    default, scores are clamped to 1–5, levels are validated (or derived from
    the score), and every list field is guaranteed to be a list of strings.
    """
    src = parsed if isinstance(parsed, dict) else {}
    raw_forces = src.get("forces")
    if not isinstance(raw_forces, dict):
        raw_forces = {}

    forces: dict[str, Any] = {}
    for key in _FORCE_KEYS:
        forces[key] = _coerce_force(raw_forces.get(key))

    return {
        "forces": forces,
        "overall_attractiveness": _coerce_attractiveness(
            src.get("overall_attractiveness")
        ),
        "summary": _coerce_str(src.get("summary")),
    }


# ── public contract ───────────────────────────────────────────────────────────

def porter_get(topic: str) -> dict[str, Any]:
    """Pure read of the cached artifact. Never raises."""
    art = get_artifact(topic, "porter")
    if not art:
        return {"topic": topic, "kind": "porter", "computed": False, "data": {}}
    return {
        "topic": topic,
        "kind": "porter",
        "computed": True,
        "data": art["data"],
        "provider": art["provider"],
        "updated_at": art["updated_at"],
    }


def porter_compute(topic: str, provider: str | None = None) -> dict[str, Any]:
    """Run the Five Forces synthesis for ``topic``, persist it, and return it.

    Degrades gracefully: returns ``computed: False`` with a reason when the
    evidence is too thin or no LLM is configured / the model returns nothing
    usable.
    """
    ctx = topic_context(topic)
    if context_is_thin(ctx):
        return {
            "topic": topic,
            "kind": "porter",
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
            "kind": "porter",
            "computed": False,
            "reason": "No LLM configured, or the model returned no usable JSON. "
                      "Add an API key in Settings → API keys.",
        }
    data = _normalize(parsed)
    art = put_artifact(topic, "porter", data, provider=name, model=model)
    return {
        "topic": topic,
        "kind": "porter",
        "computed": True,
        "data": data,
        "provider": name,
        "updated_at": art["updated_at"],
    }


__all__ = ["porter_get", "porter_compute"]
