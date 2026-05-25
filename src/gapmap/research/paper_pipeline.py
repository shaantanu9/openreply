"""Research-paper and experiment planning pipeline.

Provides a structured, citation-aware workflow:
1) outline
2) draft (IMRaD by default)
3) experiment plan
4) export with citations appendix
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db
from .insights import load_insights, synthesize_insights
from .report_pro import render_citations_md


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ensure_report(topic: str, provider: str | None = None) -> dict[str, Any]:
    cached = load_insights(topic)
    if cached and isinstance(cached, dict):
        return cached
    return synthesize_insights(topic=topic, provider=provider, persist=True)


def _top_findings(report: dict[str, Any], n: int = 6) -> list[dict[str, Any]]:
    findings = report.get("findings") if isinstance(report.get("findings"), list) else []
    findings = [f for f in findings if isinstance(f, dict)]
    findings.sort(key=lambda f: float(f.get("opportunity_score") or 0), reverse=True)
    return findings[:n]


def paper_outline_generate(topic: str, provider: str | None = None) -> dict[str, Any]:
    """Generate a structured paper outline from topic insights."""
    report = _ensure_report(topic, provider=provider)
    if not isinstance(report, dict) or report.get("ok") is False:
        return {"ok": False, "topic": topic, "error": report.get("error") if isinstance(report, dict) else "no report"}
    findings = _top_findings(report, n=6)
    outline = {
        "title": f"Evidence-driven market research on {topic}",
        "sections": [
            {"id": "abstract", "heading": "Abstract", "notes": "Problem, method, top findings, and implications."},
            {"id": "introduction", "heading": "Introduction", "notes": "Motivation, scope, and contribution."},
            {"id": "related_work", "heading": "Related Work", "notes": "Position findings against known frameworks and prior work."},
            {"id": "methods", "heading": "Methods", "notes": "Data sources, collection, filtering, and synthesis process."},
            {"id": "results", "heading": "Results", "notes": "Opportunity-ranked findings with evidence."},
            {"id": "discussion", "heading": "Discussion", "notes": "Interpretation, practical implications, and trade-offs."},
            {"id": "limitations", "heading": "Limitations", "notes": "Biases, source constraints, and model limitations."},
            {"id": "experiments", "heading": "Experiment Plan", "notes": "Falsifiable hypotheses, success metrics, and next tests."},
            {"id": "conclusion", "heading": "Conclusion", "notes": "Summary and future work."},
        ],
        "key_findings": [
            {
                "title": f.get("title"),
                "opportunity_score": f.get("opportunity_score"),
                "triangulation_strength": f.get("triangulation_strength"),
                "source_breakdown": f.get("source_breakdown") or {},
            }
            for f in findings
        ],
        "generated_at": _now_iso(),
    }
    return {"ok": True, "topic": topic, "outline": outline, "report_cached": bool(report.get("_cached"))}


def experiment_plan_generate(topic: str, provider: str | None = None) -> dict[str, Any]:
    """Generate falsifiable experiments from hypothesis cards or findings."""
    report = _ensure_report(topic, provider=provider)
    if not isinstance(report, dict) or report.get("ok") is False:
        return {"ok": False, "topic": topic, "error": report.get("error") if isinstance(report, dict) else "no report"}
    hypotheses = report.get("hypotheses") if isinstance(report.get("hypotheses"), list) else []
    experiments: list[dict[str, Any]] = []
    if hypotheses:
        for i, h in enumerate(hypotheses[:8], 1):
            if not isinstance(h, dict):
                continue
            experiments.append(
                {
                    "id": f"exp_{i}",
                    "hypothesis": h.get("we_believe") or h.get("experiences") or "Untitled hypothesis",
                    "test_design": h.get("cheapest_test") or "Define a minimum viable test.",
                    "success_metric": "Conversion/engagement uplift vs baseline",
                    "failure_criteria": h.get("falsifiers") or ["No statistically meaningful uplift."],
                    "time_box_days": h.get("time_box_days") or 14,
                    "budget_usd": h.get("budget_usd") or 100,
                }
            )
    else:
        findings = _top_findings(report, n=4)
        for i, f in enumerate(findings, 1):
            experiments.append(
                {
                    "id": f"exp_{i}",
                    "hypothesis": f"If we address '{f.get('title')}', activation and retention should improve.",
                    "test_design": "A/B test onboarding/copy intervention against current baseline.",
                    "success_metric": "Activation rate, D7 retention, and conversion delta",
                    "failure_criteria": ["No improvement over baseline after time box."],
                    "time_box_days": 14,
                    "budget_usd": 150,
                }
            )
    return {"ok": True, "topic": topic, "experiments": experiments, "generated_at": _now_iso()}


def paper_draft_generate(topic: str, provider: str | None = None, style: str = "IMRaD") -> dict[str, Any]:
    """Generate a structured markdown draft from insights."""
    report = _ensure_report(topic, provider=provider)
    if not isinstance(report, dict) or report.get("ok") is False:
        return {"ok": False, "topic": topic, "error": report.get("error") if isinstance(report, dict) else "no report"}
    findings = _top_findings(report, n=6)
    exp = experiment_plan_generate(topic, provider=provider)
    executive = (report.get("executive_summary") or "").strip()
    governing = (report.get("governing_thought") or "").strip()
    lines = [
        f"# Evidence-driven market research on {topic}",
        "",
        f"_Generated: {_now_iso()} · style: {style}_",
        "",
        "## Abstract",
        executive or "This paper synthesizes multi-source evidence to identify high-opportunity user problems and practical interventions.",
        "",
        "## Introduction",
        f"This study investigates {topic} using a multi-source corpus and structured synthesis pipeline to prioritize actionable opportunities.",
        "",
        "## Related Work",
        "We position findings against persuasion and growth frameworks (Cialdini, STEPPS, Schwartz awareness stages, and behavior-design patterns).",
        "",
        "## Methods",
        "- Multi-source collection (community, review, and research feeds)",
        "- Structural + semantic graph enrichment",
        "- Opportunity scoring, triangulation checks, and tactic mapping",
        "",
        "## Results",
        governing or "Top opportunities are ranked below by opportunity score and evidence diversity.",
        "",
    ]
    for i, f in enumerate(findings, 1):
        lines.extend(
            [
                f"### {i}. {f.get('title')}",
                f"- Opportunity score: {f.get('opportunity_score')}",
                f"- Triangulation: {f.get('triangulation_strength')}",
                f"- Source breakdown: {f.get('source_breakdown') or {}}",
                f"- Narrative: {f.get('narrative') or ''}",
                "",
            ]
        )
    lines.extend(
        [
            "## Discussion",
            "Findings indicate where user pain is both severe and under-served; suggested tactics translate evidence into testable interventions.",
            "",
            "## Limitations",
            "- Source availability and API/RSS variability",
            "- Possible recency and platform bias",
            "- LLM synthesis quality depends on corpus quality",
            "",
            "## Experiment Plan",
        ]
    )
    for e in (exp.get("experiments") or [])[:6]:
        lines.extend(
            [
                f"- **{e.get('id')}**: {e.get('hypothesis')}",
                f"  - Test: {e.get('test_design')}",
                f"  - Metric: {e.get('success_metric')}",
                f"  - Failure criteria: {', '.join(e.get('failure_criteria') or [])}",
            ]
        )
    lines.extend(["", "## Conclusion", "This report provides an evidence-backed roadmap for prioritization and validation."])
    return {"ok": True, "topic": topic, "style": style, "markdown": "\n".join(lines), "generated_at": _now_iso()}


def paper_export_with_citations(
    topic: str,
    provider: str | None = None,
    format: str = "markdown",
    style: str = "IMRaD",
) -> dict[str, Any]:
    """Export a paper draft with citation appendix."""
    fmt = (format or "markdown").lower().strip()
    if fmt != "markdown":
        return {"ok": False, "topic": topic, "error": f"unsupported format: {format}. supported: markdown"}
    draft = paper_draft_generate(topic=topic, provider=provider, style=style)
    if not draft.get("ok"):
        return draft
    citations_md = render_citations_md(topic)
    out = f"{draft['markdown']}\n\n---\n\n## Citation Appendix\n\n{citations_md}\n"
    return {"ok": True, "topic": topic, "format": "markdown", "content": out, "generated_at": _now_iso()}


__all__ = [
    "paper_outline_generate",
    "paper_draft_generate",
    "experiment_plan_generate",
    "paper_export_with_citations",
]
