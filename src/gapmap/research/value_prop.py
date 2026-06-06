"""Value Proposition Canvas (Strategyzer — Osterwalder et al.).

Per topic we synthesise the two halves of the canvas and the fit between them:

* **Customer Profile** — the *jobs* the user is trying to get done (functional /
  social / emotional), the *pains* they hit doing them, and the *gains* they
  hope for.
* **Value Map** — the *products / services* on offer, the *pain relievers*
  that kill each pain, and the *gain creators* that produce the desired gains.
* **fit_note** — a short prose call on where the offering fits the customer and
  the single biggest gap still to close.

The customer side is grounded in the *real* evidence (painpoints, complaints,
feature-wishes mined from the corpus) via ``strategy_common.topic_context`` — it
is never invented. The value-map side is the strategist's proposed response.

Public surface (the exact strategy-module contract):

    value_prop_get(topic)              -> cached artifact dict (pure read, never raises)
    value_prop_compute(topic, provider=None) -> run the LLM, persist, return it

All shared concerns (provider resolution, tolerant JSON parsing, evidence
gathering, persistence to ``strategy_artifacts``) live in ``strategy_common``.
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

# ── prompt constants (module-level, no import side effects) ───────────────────

SYSTEM = (
    "You are an evidence-grounded product-strategy analyst building a "
    "Strategyzer Value Proposition Canvas. You map a Customer Profile "
    "(jobs / pains / gains) against a Value Map (products / pain relievers / "
    "gain creators) and judge the fit between them.\n"
    "Hard rules:\n"
    "- The customer JOBS and PAINS must be drawn from the supplied evidence "
    "(painpoints, complaints, feature wishes). Do not invent customer pain "
    "that the evidence does not support.\n"
    "- Pain relievers and gain creators must each plausibly respond to a "
    "specific pain or gain — keep them concrete and buildable.\n"
    "- Be specific and concise; each list item is a short phrase, not a "
    "paragraph.\n"
    "Output STRICT raw JSON only. No prose, no markdown, no code fences."
)

PROMPT = (
    "Build a Value Proposition Canvas from the evidence below.\n\n"
    "{evidence}\n\n"
    "Return EXACTLY this JSON shape (raw JSON, no markdown):\n"
    "{{\n"
    '  "customer": {{\n'
    '    "jobs": ["functional, social and emotional jobs the user is trying to get done"],\n'
    '    "pains": ["the frustrations / obstacles / risks — grounded in the evidence"],\n'
    '    "gains": ["the outcomes and benefits the user wants"]\n'
    "  }},\n"
    '  "value_map": {{\n'
    '    "products": ["the offering / products & services that address the jobs"],\n'
    '    "pain_relievers": ["how the offering kills each specific pain"],\n'
    '    "gain_creators": ["how the offering produces the desired gains"]\n'
    "  }},\n"
    '  "fit_note": "1-3 sentences: where the product fits the customer, and the single biggest gap still to close"\n'
    "}}\n\n"
    "Give 3-6 items per list. Keep every item a short, specific phrase."
)


# ── normalisation ─────────────────────────────────────────────────────────────

def _str_list(val: Any, *, cap: int = 12, item_max: int = 240) -> list[str]:
    """Coerce *val* into a clean list of non-empty trimmed strings."""
    out: list[str] = []
    if isinstance(val, list):
        items = val
    elif isinstance(val, (str, int, float)) and not isinstance(val, bool):
        items = [val]
    else:
        items = []
    for it in items:
        if isinstance(it, dict):
            # tolerate {"text": "..."} / {"value": "..."} / {"label": "..."} shapes
            it = it.get("text") or it.get("value") or it.get("label") or ""
        if isinstance(it, bool):
            continue
        s = str(it).strip() if it is not None else ""
        if s:
            out.append(s[:item_max])
        if len(out) >= cap:
            break
    return out


def _normalize(parsed: dict[str, Any]) -> dict[str, Any]:
    """Coerce the raw LLM dict into the documented shape with safe defaults.

    Never raises / never KeyErrors. List fields become lists of strings; the
    fit note becomes a trimmed string.
    """
    parsed = parsed if isinstance(parsed, dict) else {}

    cust = parsed.get("customer")
    cust = cust if isinstance(cust, dict) else {}
    vmap = parsed.get("value_map")
    vmap = vmap if isinstance(vmap, dict) else {}

    fit = parsed.get("fit_note")
    if isinstance(fit, (list, tuple)):
        fit = " ".join(str(x) for x in fit)
    fit_note = str(fit).strip()[:1200] if fit is not None else ""

    return {
        "customer": {
            "jobs": _str_list(cust.get("jobs")),
            "pains": _str_list(cust.get("pains")),
            "gains": _str_list(cust.get("gains")),
        },
        "value_map": {
            "products": _str_list(vmap.get("products")),
            "pain_relievers": _str_list(vmap.get("pain_relievers")),
            "gain_creators": _str_list(vmap.get("gain_creators")),
        },
        "fit_note": fit_note,
    }


# ── public surface ────────────────────────────────────────────────────────────

def value_prop_get(topic: str) -> dict[str, Any]:
    """Pure read of the cached artifact. Never raises."""
    art = get_artifact(topic, "value_prop")
    if not art:
        return {"topic": topic, "kind": "value_prop", "computed": False, "data": {}}
    return {"topic": topic, "kind": "value_prop", "computed": True,
            "data": art["data"], "provider": art["provider"], "updated_at": art["updated_at"]}


def value_prop_compute(topic: str, provider: str | None = None) -> dict[str, Any]:
    """Synthesise the Value Proposition Canvas from corpus evidence and persist it."""
    ctx = topic_context(topic)
    if context_is_thin(ctx):
        return {"topic": topic, "kind": "value_prop", "computed": False,
                "reason": "Not enough evidence yet — collect posts and build the graph for this topic first."}
    parsed, name, model = run_llm_json(
        PROMPT.format(evidence=context_brief(ctx)), SYSTEM,
        provider=provider, max_tokens=1800, temperature=0.3,
    )
    if not parsed:
        return {"topic": topic, "kind": "value_prop", "computed": False,
                "reason": "No LLM configured, or the model returned no usable JSON. Add an API key in Settings → API keys."}
    data = _normalize(parsed)
    art = put_artifact(topic, "value_prop", data, provider=name, model=model)
    return {"topic": topic, "kind": "value_prop", "computed": True,
            "data": data, "provider": name, "updated_at": art["updated_at"]}


__all__ = ["value_prop_get", "value_prop_compute"]
