"""Real research conclusions — the PhD-student payoff.

Takes everything the pipeline has learned about a topic's literature — the
papers, the **novel connections** (cross-paper links the literature hasn't
made), the cross-paper gaps, and the corpus themes — and synthesises an
evidence-backed research synthesis: a thesis, key findings, the novel
contributions/links surfaced, defensible conclusions, open questions, and a
suggested research direction.

This is what turns "I collected 80 papers" into "here is what they collectively
say, what's missing, and what I should research next." Grounded: every section
is built from already-computed signals (connections / gaps / themes), and the
LLM is told to cite the evidence rather than invent it.

``research_conclusions_get`` is a pure read; ``research_conclusions_compute``
runs one LLM synthesis and persists. Both never raise.
"""
from __future__ import annotations

from typing import Any

from .strategy_common import get_artifact, put_artifact, run_llm_json, topic_context, context_brief

KIND = "research_conclusions"


def research_conclusions_get(topic: str) -> dict[str, Any]:
    """Pure read of the cached research-synthesis artifact. Never raises."""
    art = get_artifact(topic, KIND)
    if not art:
        return {"topic": topic, "kind": KIND, "computed": False, "data": {}}
    return {
        "topic": topic, "kind": KIND, "computed": True,
        "data": art["data"], "provider": art["provider"],
        "updated_at": art["updated_at"],
    }


def _evidence_bundle(topic: str) -> dict[str, Any]:
    """Pull the grounded inputs: papers count, novel connections, gaps, themes."""
    bundle: dict[str, Any] = {"paper_count": 0, "connections": [], "gaps": []}

    # Paper count (academic posts tagged to the topic).
    try:
        from .paper_export import _papers_for_topic
        bundle["paper_count"] = len(_papers_for_topic(topic))
    except Exception:
        pass

    # Novel connections (the differentiator) — read cached, else best-effort compute.
    try:
        from .connections import connections_get, connections_compute
        c = connections_get(topic)
        if not c.get("computed"):
            c = connections_compute(topic, enrich=False)
        for x in ((c.get("data") or {}).get("connections") or [])[:12]:
            bundle["connections"].append({
                "kind": x.get("kind"), "title": x.get("title"),
                "why_new": x.get("why_new"), "novelty": x.get("novelty_score"),
            })
    except Exception:
        pass

    # Cross-paper gaps.
    try:
        from .paper_gaps import list_gaps
        g = list_gaps(topic)
        for x in (g.get("gaps") or [])[:10]:
            bundle["gaps"].append({"kind": x.get("kind"), "title": x.get("title")})
    except Exception:
        pass

    return bundle


_SYSTEM = (
    "You are a rigorous PhD research advisor. Given a topic's literature signals "
    "(paper count, novel cross-paper connections, gaps, and corpus themes), write "
    "an evidence-grounded research synthesis. Be specific and defensible; do NOT "
    "invent citations or numbers beyond what the signals support. Output strict "
    "JSON only, no markdown fences."
)

_PROMPT = (
    "Topic: {topic}\n"
    "Papers in corpus: {paper_count}\n\n"
    "Novel cross-paper connections (links the literature hasn't made):\n{connections}\n\n"
    "Cross-paper gaps:\n{gaps}\n\n"
    "Corpus themes / evidence:\n{themes}\n\n"
    "Produce JSON with EXACTLY this shape:\n"
    '{{"thesis": "one-sentence overarching thesis of what this literature shows",\n'
    '  "key_findings": ["3-6 evidence-backed findings across the papers"],\n'
    '  "novel_contributions": ["2-5 connections/relations worth pursuing — what is new and why"],\n'
    '  "conclusions": ["3-5 defensible conclusions a reviewer would accept"],\n'
    '  "open_questions": ["3-5 unanswered questions the gaps imply"],\n'
    '  "suggested_direction": "one concrete next research direction (a study/paper to do)",\n'
    '  "confidence": "low|medium|high",\n'
    '  "confidence_reason": "why, given corpus size + evidence"}}'
)


def _str_list(v: Any, cap: int = 8) -> list[str]:
    if not isinstance(v, list):
        return []
    out = []
    for x in v:
        s = str(x).strip()
        if s:
            out.append(s)
    return out[:cap]


def _normalize(parsed: dict[str, Any]) -> dict[str, Any]:
    conf = str(parsed.get("confidence") or "low").lower()
    if conf not in ("low", "medium", "high"):
        conf = "low"
    return {
        "thesis": str(parsed.get("thesis") or "").strip(),
        "key_findings": _str_list(parsed.get("key_findings")),
        "novel_contributions": _str_list(parsed.get("novel_contributions")),
        "conclusions": _str_list(parsed.get("conclusions")),
        "open_questions": _str_list(parsed.get("open_questions")),
        "suggested_direction": str(parsed.get("suggested_direction") or "").strip(),
        "confidence": conf,
        "confidence_reason": str(parsed.get("confidence_reason") or "").strip(),
    }


def research_conclusions_compute(topic: str, provider: str | None = None) -> dict[str, Any]:
    """Synthesise + persist evidence-grounded research conclusions. Never raises."""
    bundle = _evidence_bundle(topic)
    if bundle["paper_count"] < 2 and not bundle["connections"] and not bundle["gaps"]:
        return {
            "topic": topic, "kind": KIND, "computed": False,
            "reason": ("Not enough literature yet — collect academic papers and "
                       "build the paper knowledge (full text → gaps → connections) "
                       "for this topic first."),
        }

    def _fmt(items: list[dict], *keys: str) -> str:
        if not items:
            return "  (none yet)"
        lines = []
        for it in items:
            parts = [str(it.get(k)) for k in keys if it.get(k)]
            lines.append("  - " + " — ".join(parts))
        return "\n".join(lines)

    ctx = topic_context(topic)
    prompt = _PROMPT.format(
        topic=topic,
        paper_count=bundle["paper_count"],
        connections=_fmt(bundle["connections"], "title", "why_new"),
        gaps=_fmt(bundle["gaps"], "kind", "title"),
        themes=context_brief(ctx),
    )
    parsed, name, model = run_llm_json(prompt, _SYSTEM, provider=provider,
                                       max_tokens=2000, temperature=0.3)
    if not parsed:
        return {
            "topic": topic, "kind": KIND, "computed": False,
            "reason": ("No LLM configured, or the model returned no usable JSON. "
                       "Add an API key in Settings → API keys."),
        }

    data = _normalize(parsed)
    data["evidence"] = {
        "paper_count": bundle["paper_count"],
        "connection_count": len(bundle["connections"]),
        "gap_count": len(bundle["gaps"]),
    }
    art = put_artifact(topic, KIND, data, provider=name, model=model)
    return {
        "topic": topic, "kind": KIND, "computed": True,
        "data": data, "provider": name, "updated_at": art["updated_at"],
    }


__all__ = ["research_conclusions_get", "research_conclusions_compute", "KIND"]
