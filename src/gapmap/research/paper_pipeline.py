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
from ..analyze.providers.base import get_provider, resolve_provider
from .insights import load_insights, synthesize_insights
from .paper_export import (
    _papers_for_topic,
    _split_title_venue,
    _year,
    to_apa,
    to_bibtex,
)
from .paper_fulltext import get_full_text_or_abstract
from .report_pro import render_citations_md


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def run_paper_research(
    topic: str,
    query: str | None = None,
    limit_per_source: int = 5,
    max_fulltext: int = 3,
    year_from: int | None = None,
    provider: str | None = None,
    sources: list[str] | None = None,
) -> dict[str, Any]:
    """Search → rank → fulltext → analyze → store, in one synchronous call.

    Shared by the `gapmap_paper_research_pipeline` MCP tool and the chat
    agent's `fetch_more_papers` tool so both go through one code path. No
    streaming, no job spawning — returns a result dict directly. Callers that
    need a wall-clock ceiling should wrap this in their own timeout.
    """
    from ..sources.arxiv import fetch_arxiv
    from ..sources.pubmed import fetch_pubmed
    from ..sources.openalex import fetch_openalex
    from ..sources.semantic_scholar import fetch_semantic_scholar
    from ..sources.crossref import fetch_crossref
    from ..sources.scholar import fetch_scholar
    from ..core.db import upsert_posts, get_db
    from concurrent.futures import ThreadPoolExecutor, as_completed

    q = query or topic
    wanted_sources = sources or [
        "arxiv", "pubmed", "openalex", "semantic_scholar", "crossref", "scholar", "europepmc",
    ]

    runners = {
        "arxiv":            lambda: fetch_arxiv(query=q, limit=limit_per_source),
        "pubmed":           lambda: fetch_pubmed(query=q, limit=limit_per_source),
        "openalex":         lambda: fetch_openalex(query=q, limit=limit_per_source, year_from=year_from),
        "semantic_scholar": lambda: fetch_semantic_scholar(query=q, limit=limit_per_source, year_from=year_from),
        "crossref":         lambda: fetch_crossref(query=q, limit=limit_per_source, year_from=year_from),
        "scholar":          lambda: fetch_scholar(query=q, limit=limit_per_source, year_from=year_from),
    }

    by_source: dict[str, int] = {}
    all_rows: list[dict] = []
    errors: dict[str, str] = {}

    # Run all sources in parallel
    with ThreadPoolExecutor(max_workers=6) as ex:
        future_to_src = {ex.submit(runners[s]): s for s in wanted_sources if s in runners}
        for fut in as_completed(future_to_src):
            src = future_to_src[fut]
            try:
                rows = fut.result() or []
                by_source[src] = len(rows)
                all_rows.extend(rows)
            except Exception as e:
                errors[src] = str(e)[:200]
                by_source[src] = 0

    # Dedupe by id
    seen: set[str] = set()
    unique: list[dict] = []
    for r in all_rows:
        pid = r.get("id")
        if pid and pid not in seen:
            seen.add(pid)
            unique.append(r)

    # Persist all to posts table + tag to topic
    if unique:
        upsert_posts(unique)
        db = get_db()
        now = _now_iso()
        db["topic_posts"].insert_all(
            [{"topic": topic, "post_id": r["id"], "source": r.get("source_type", ""),
              "added_at": now} for r in unique],
            pk=("topic", "post_id"), replace=True,
        )

    # 2. RANK — sort by citation count (score field) descending, take top max_fulltext
    ranked = sorted(unique, key=lambda r: int(r.get("score") or 0), reverse=True)
    top_for_fulltext = ranked[:max_fulltext]

    # 3. FULLTEXT — fetch PDF text for top papers
    from .paper_fulltext import get_full_text
    fulltext_ok = 0
    fulltext_fetched = 0
    fulltext_post_ids: list[str] = []  # papers that actually got full text
    for paper in top_for_fulltext:
        post_id = paper.get("id")
        if not post_id:
            continue
        fulltext_fetched += 1
        try:
            result = get_full_text(post_id)
            if result.get("ok"):
                fulltext_ok += 1
                fulltext_post_ids.append(post_id)
        except Exception as e:
            errors[f"fulltext_{post_id}"] = str(e)[:200]

    # 3b. CHUNK + EMBED — chunk only the papers that actually got full text.
    # chunk_paper is idempotent and local-CPU (ONNX embed). Skip the whole
    # pass when the palace/ChromaDB embed backend is unavailable; guard each
    # call so one chunk failure never aborts the pipeline.
    papers_chunked = 0
    try:
        from ..retrieval import palace
        embed_available = palace.is_available()
    except Exception:
        embed_available = False
    if embed_available and fulltext_post_ids:
        from .paper_chunks import chunk_paper
        for post_id in fulltext_post_ids:
            try:
                res = chunk_paper(post_id, embed=True)
                if res.get("ok") and res.get("embedded"):
                    papers_chunked += 1
            except Exception as e:
                errors[f"chunk_{post_id}"] = str(e)[:200]

    # 4. ANALYZE — run LLM analysis for each paper that has content
    from .paper_analyze import analyze_paper
    analyses_out = []
    analyzed = 0
    for paper in top_for_fulltext:
        post_id = paper.get("id")
        if not post_id:
            continue
        try:
            res = analyze_paper(topic=topic, post_id=post_id, force=False)
            if res.get("ok") and not res.get("skipped"):
                analyzed += 1
                analyses_out.append({
                    "post_id": post_id,
                    "title": paper.get("title", "")[:200],
                    "url": paper.get("url", ""),
                    "source_type": paper.get("source_type", ""),
                    "citation_count": int(paper.get("score") or 0),
                    "summary": res.get("summary", ""),
                    "relevance": res.get("relevance", ""),
                    "takeaway": res.get("takeaway", ""),
                })
        except Exception as e:
            errors[f"analyze_{post_id}"] = str(e)[:200]

    return {
        "ok": True,
        "topic": topic,
        "query": q,
        "search_total": len(unique),
        "by_source": by_source,
        "fulltext_fetched": fulltext_fetched,
        "fulltext_ok": fulltext_ok,
        "papers_chunked": papers_chunked,
        "analyzed": analyzed,
        "analyses": analyses_out,
        "errors": errors,
    }


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


def _template_draft(
    topic: str,
    report: dict[str, Any],
    style: str,
    provider: str | None = None,
) -> dict[str, Any]:
    """Deterministic (no-LLM) markdown draft from insights.

    This is the original draft path — kept as a graceful fallback for users
    without an LLM key configured. Returns the standard draft dict with
    `grounded: False` and `papers_used: 0`.
    """
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
    return {
        "ok": True,
        "topic": topic,
        "style": style,
        "markdown": "\n".join(lines),
        "generated_at": _now_iso(),
        "grounded": False,
        "papers_used": 0,
    }


def _draft_references(papers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build a numbered reference list (title/author/year/abstract) from
    academic-paper rows. `paper_export` packs the venue into `title` as
    'Title  — Venue' — split it back so the prompt sees a clean title.
    """
    refs: list[dict[str, Any]] = []
    for i, p in enumerate(papers, 1):
        title, venue = _split_title_venue(p)
        refs.append(
            {
                "n": i,
                "post_id": p.get("id"),
                "title": title,
                "venue": venue,
                "author": (p.get("author") or "").strip(),
                "year": _year(p),
                "abstract": (p.get("selftext") or "").strip(),
                "url": p.get("url") or "",
            }
        )
    return refs


# Total prompt budget (chars) — keeps us well inside model context windows
# while leaving room for the findings block + reference list.
_DRAFT_PROMPT_BUDGET = 12_000

_DRAFT_SYSTEM_PROMPT = (
    "You are a research analyst writing an evidence-grounded IMRaD market-"
    "research paper. You write in clean Markdown. You ONLY make claims "
    "supported by the corpus findings and the reference papers provided. "
    "Cite papers inline as [n] using the numbered reference list given to "
    "you — never invent citations or references not in that list."
)


def paper_draft_generate(topic: str, provider: str | None = None, style: str = "IMRaD") -> dict[str, Any]:
    """Generate a structured markdown draft from insights.

    When an LLM is configured the body is generated by the model, grounded in
    (a) the top corpus findings, (b) the topic's academic papers, and (c) short
    full-text snippets for the top papers — and cites papers inline as `[n]`.
    When no LLM is available it falls back to the deterministic
    :func:`_template_draft` so callers without a key never break.

    Returns the standard draft dict plus `grounded` (bool) and
    `papers_used` (int).
    """
    report = _ensure_report(topic, provider=provider)
    if not isinstance(report, dict) or report.get("ok") is False:
        return {"ok": False, "topic": topic, "error": report.get("error") if isinstance(report, dict) else "no report"}

    # No-LLM gate: resolve_provider raises when nothing is configured.
    try:
        resolve_provider(None)
    except Exception:
        return _template_draft(topic, report, style, provider=provider)

    findings = _top_findings(report, n=8)
    papers = _papers_for_topic(topic, limit=12)
    refs = _draft_references(papers)
    if not refs:
        # No academic papers to ground against — graceful template fallback.
        return _template_draft(topic, report, style, provider=provider)

    # Build the findings block (compact — title + scores + short narrative).
    findings_lines: list[str] = []
    for i, f in enumerate(findings, 1):
        narrative = (f.get("narrative") or "")[:300]
        findings_lines.append(
            f"{i}. {f.get('title')} "
            f"(opportunity={f.get('opportunity_score')}, "
            f"triangulation={f.get('triangulation_strength')}) — {narrative}"
        )
    findings_block = "\n".join(findings_lines) or "(no findings)"

    # Build the research-gaps block — the open problems the paper should
    # position its contribution against. Pulled from paper_gaps (understudied
    # intersections / contradictions / temporal / method-replication). Empty
    # when the detector hasn't run, so this degrades cleanly to the old behaviour.
    gaps_block = ""
    try:
        from .paper_gaps import list_gaps
        _gl = list_gaps(topic)
        _gap_lines: list[str] = []
        for g in (_gl.get("gaps") or [])[:8]:
            _why = (g.get("detail") or {}).get("why") or ""
            _gap_lines.append(f"- [{g.get('kind')}] {g.get('title')}" + (f" — {_why}" if _why else ""))
        gaps_block = "\n".join(_gap_lines)
    except Exception:
        gaps_block = ""

    # Build the reference block the model must cite against.
    ref_lines: list[str] = []
    for r in refs:
        abstract = (r["abstract"] or "")[:400]
        ref_lines.append(
            f"[{r['n']}] {r['title']}"
            + (f" ({r['venue']})" if r["venue"] else "")
            + (f", {r['year']}" if r["year"] else "")
            + (f". {abstract}" if abstract else "")
        )
    ref_block = "\n".join(ref_lines)

    # Optionally enrich the top 2-3 papers with short cached full-text snippets.
    snippet_lines: list[str] = []
    for r in refs[:3]:
        pid = r.get("post_id")
        if not pid:
            continue
        try:
            ft = get_full_text_or_abstract(pid, max_chars=2500)
        except Exception:
            continue
        if ft.get("ok") and (ft.get("tier") == "full_text") and ft.get("text"):
            snippet_lines.append(f"--- [{r['n']}] {r['title']} (excerpt) ---\n{ft['text']}")
    snippet_block = "\n\n".join(snippet_lines)

    # Assemble + bound the prompt. Trim the (least essential) snippet block
    # first, then the reference block, to stay under budget.
    def _assemble(snip: str, refs_txt: str) -> str:
        parts = [
            f'Topic: "{topic}"',
            f"Paper style: {style} (Abstract, Introduction, Related Work, Methods, "
            "Results, Discussion, Limitations, Conclusion).",
            "",
            "TOP CORPUS FINDINGS (opportunity-ranked, from a multi-source pain-signal corpus):",
            findings_block,
            "",
            "REFERENCE PAPERS (cite these inline as [n] — do not invent others):",
            refs_txt,
        ]
        if gaps_block:
            parts += [
                "",
                "RESEARCH GAPS detected across the literature (understudied "
                "intersections, contradictions, temporal lulls, under-replicated "
                "findings) — frame the paper's contribution as addressing these:",
                gaps_block,
            ]
        if snip:
            parts += ["", "FULL-TEXT EXCERPTS FROM THE TOP PAPERS:", snip]
        parts += [
            "",
            "Write the full IMRaD paper in Markdown. Start with an H1 title. "
            "Ground every empirical claim in the findings or the reference "
            "papers, citing papers inline as [n]. In Related Work and "
            "Discussion, explicitly position the contribution against the "
            "RESEARCH GAPS above. End with a '## References' section listing "
            "each [n] paper. Be concrete and specific to the topic — no boilerplate.",
        ]
        return "\n".join(parts)

    prompt = _assemble(snippet_block, ref_block)
    if len(prompt) > _DRAFT_PROMPT_BUDGET:
        prompt = _assemble("", ref_block)
    if len(prompt) > _DRAFT_PROMPT_BUDGET:
        # Last resort: trim the reference block to fit.
        ref_block = ref_block[: _DRAFT_PROMPT_BUDGET // 2]
        prompt = _assemble("", ref_block)

    try:
        provider_obj = get_provider()
        markdown = provider_obj.complete(
            prompt=prompt,
            system=_DRAFT_SYSTEM_PROMPT,
            max_tokens=4000,
            temperature=0.3,
        )
        markdown = (markdown or "").strip()
        if not markdown:
            raise RuntimeError("empty LLM response")
    except Exception:
        # LLM call failed at runtime — degrade gracefully to the template.
        return _template_draft(topic, report, style, provider=provider)

    header = f"_Generated: {_now_iso()} · style: {style} · grounded in {len(refs)} papers_\n\n"
    markdown = header + markdown
    return {
        "ok": True,
        "topic": topic,
        "style": style,
        "markdown": markdown,
        "generated_at": _now_iso(),
        "grounded": True,
        "papers_used": len(refs),
    }


def _slug(s: str) -> str:
    import re as _re

    return _re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_")[:60] or "topic"


def _export_dir(topic: str) -> "Path":
    """Resolve `<data_dir>/exports/papers/<topic_slug>/`, creating it.

    Matches the data-dir convention used elsewhere (export_deck /
    paper_fulltext resolve via `_resolve_data_dir`)."""
    from pathlib import Path

    try:
        from ..core.config import _resolve_data_dir

        base = _resolve_data_dir()
    except Exception:
        base = Path.home() / ".gapmap"
    out = Path(base) / "exports" / "papers" / _slug(topic)
    out.mkdir(parents=True, exist_ok=True)
    return out


def paper_export_with_citations(
    topic: str,
    provider: str | None = None,
    format: str = "markdown",
    style: str = "IMRaD",
) -> dict[str, Any]:
    """Export a paper draft with a real references section + citation appendix.

    Formats:
      - ``markdown`` (default): returns the doc as ``content``.
      - ``docx`` / ``pdf``: renders the doc to a file in the topic's export
        dir and returns its absolute ``path``. Falls back to writing the
        markdown to a ``.md`` file (with a ``note``) if the docx/pdf infra
        isn't importable.
    """
    from pathlib import Path

    fmt = (format or "markdown").lower().strip()
    if fmt not in ("markdown", "docx", "pdf"):
        return {
            "ok": False,
            "topic": topic,
            "error": f"unsupported format: {format}. supported: markdown, docx, pdf",
        }

    draft = paper_draft_generate(topic=topic, provider=provider, style=style)
    if not draft.get("ok"):
        return draft

    # Change 2: build a real References section over the topic's academic
    # papers (APA + BibTeX), IN ADDITION to the existing citations appendix.
    papers = _papers_for_topic(topic, limit=50)
    papers_cited = len(papers)
    references_md = ""
    if papers:
        apa = to_apa(papers).strip()
        bibtex = to_bibtex(papers).strip()
        ref_items = "\n".join(f"{i}. {line}" for i, line in enumerate(apa.split("\n\n"), 1) if line.strip())
        references_md = (
            "## References\n\n"
            f"{ref_items}\n\n"
            "<details>\n<summary>BibTeX</summary>\n\n"
            f"```bibtex\n{bibtex}\n```\n\n</details>\n"
        )

    citations_md = render_citations_md(topic)
    out = draft["markdown"]
    if references_md:
        out += f"\n\n---\n\n{references_md}"
    out += f"\n\n---\n\n## Citation Appendix\n\n{citations_md}\n"

    common = {
        "ok": True,
        "topic": topic,
        "generated_at": _now_iso(),
        "grounded": draft.get("grounded", False),
        "papers_used": draft.get("papers_used", 0),
        "papers_cited": papers_cited,
    }

    if fmt == "markdown":
        return {**common, "format": "markdown", "content": out}

    # Change 3: real file export for docx / pdf. Write the markdown to disk
    # first (both builders take a markdown *file path*), then render.
    export_dir = _export_dir(topic)
    md_path = export_dir / f"{_slug(topic)}.md"
    try:
        md_path.write_text(out, encoding="utf-8")
    except OSError as e:
        return {"ok": False, "topic": topic, "error": f"failed to write markdown: {e}"}

    try:
        if fmt == "docx":
            from .export_deck import build_docx_from_markdown

            out_path = str(export_dir / f"{_slug(topic)}.docx")
            res = build_docx_from_markdown(md_path=str(md_path), out_path=out_path)
        else:  # pdf
            from .export_deck import build_pdf_from_markdown

            out_path = str(export_dir / f"{_slug(topic)}.pdf")
            res = build_pdf_from_markdown(
                md_path=str(md_path), out_path=out_path, title=topic
            )
    except Exception as e:
        # Infra not importable — fall back to the markdown file on disk.
        return {
            **common,
            "format": fmt,
            "path": str(md_path),
            "note": f"{fmt} infra unavailable ({type(e).__name__}: {e}); wrote markdown instead",
        }

    if not res.get("ok"):
        # Builder ran but failed (e.g. pandoc/xelatex missing) — keep the
        # markdown file and surface the builder's error as a note.
        return {
            **common,
            "format": fmt,
            "path": str(md_path),
            "note": f"{fmt} render failed: {res.get('error')}; wrote markdown instead",
        }

    return {
        **common,
        "format": fmt,
        "path": str(Path(res.get("path", out_path)).resolve()),
        "engine": res.get("engine"),
    }


__all__ = [
    "paper_outline_generate",
    "paper_draft_generate",
    "experiment_plan_generate",
    "paper_export_with_citations",
]
