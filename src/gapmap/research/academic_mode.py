"""Academic Mode — grounded, cited research brief orchestrator.

Chains four stages and one hard gate:

    research → synthesize → [grounding gate] → peer_review → finalize

Each executed stage records a quality `check` + a `lineage` row (reusing the
existing traceability layer), and the pipeline enforces one invariant:
**finalize may cite only academic papers actually committed to the corpus, and
refuses to run when fewer than ``min_grounded`` are grounded.**

This is pure composition of existing functions — it introduces no new LLM
prompts and no new schema beyond the ``academic_briefs`` table. Governance
levels mirror the Fleet flow: L1 suggest, L2 gated (pause for approval before
the expensive stages), L3 auto (default).

See ``docs/superpowers/specs/2026-06-14-academic-mode-mvp-design.md``.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Callable

_VALID_LEVELS = ("L1", "L2", "L3")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _safe_call(fn: Callable[[], Any], default: Any) -> tuple[Any, str | None]:
    """Run ``fn`` fail-soft. Returns (result, error_str|None)."""
    try:
        return fn(), None
    except Exception as e:  # pragma: no cover - defensive
        return default, str(e)[:300]


def _evidence_post_ids(evidence: Any) -> list[str]:
    """Pull post_ids out of a gap's evidence list. `detect_gaps` returns raw
    post_id strings; `list_gaps` (and some LLM passes) return {post_id, title}
    dicts — tolerate both, plus the odd malformed entry."""
    out: list[str] = []
    for e in evidence or []:
        if isinstance(e, str):
            out.append(e)
        elif isinstance(e, dict) and e.get("post_id"):
            out.append(e["post_id"])
    return out


def _build_review_items(gaps: list[dict], analyses: list[dict]) -> list[dict]:
    """Turn the academic synthesis (literature gaps, else paper analyses) into
    deliberation items so peer review critiques the synthesis itself."""
    items: list[dict] = []
    for g in gaps or []:
        if not isinstance(g, dict):
            continue
        ev = _evidence_post_ids(g.get("evidence"))
        items.append({
            "key": f"gap:{g.get('id') or g.get('title','')[:60]}",
            "kind": "literature_gap",
            "title": g.get("title") or g.get("detail", "")[:80] or "untitled gap",
            "label": g.get("title") or "untitled gap",
            "detail": g.get("detail", ""),
            "supporting_post_ids": ev,
        })
    if not items:
        # Fall back to reviewing the strongest paper takeaways directly.
        for a in (analyses or [])[:12]:
            items.append({
                "key": f"paper:{a.get('post_id')}",
                "kind": "paper_claim",
                "title": (a.get("title") or a.get("takeaway") or "")[:80] or a.get("post_id", ""),
                "label": (a.get("title") or a.get("post_id") or "")[:80],
                "detail": a.get("takeaway") or a.get("summary") or "",
                "supporting_post_ids": [a.get("post_id")] if a.get("post_id") else [],
            })
    return items


def _limitations_md(peer_review: dict) -> str:
    """Build an 'Acknowledged Limitations' body from peer-review dissent so
    flagged issues are never silently dropped. Accepts either the legacy
    deliberation `tiers` shape or the multi-reviewer panel `dissent` shape."""
    if not isinstance(peer_review, dict):
        return ""
    lines: list[str] = []
    # Multi-reviewer panel shape — each dissenter carries a role + why.
    for d in peer_review.get("dissent", []) or []:
        if not isinstance(d, dict):
            continue
        role = (d.get("role") or "reviewer").replace("_", " ")
        why = d.get("why") or d.get("recommendation") or "raised a concern"
        lines.append(f"- **{role}** recommended *{d.get('recommendation', 'revision')}* — {why}")
    # Legacy deliberation tiers shape (kept for back-compat / fallback path).
    tiers = peer_review.get("tiers") or {}
    for tier_name, blurb in (("minority", "minority support"), ("discarded", "not supported")):
        for it in tiers.get(tier_name, []) or []:
            title = (it.get("title") or it.get("label") or "claim") if isinstance(it, dict) else str(it)
            lines.append(f"- **{title}** — peer review flagged this as *{blurb}*.")
    return "\n".join(lines)


# Sentence-ish splitter used to pull auditable claims out of the finalized
# brief for the integrity gate. Deliberately simple (no NLP dep): drops
# headings / list bullets / code fences, then splits on sentence terminators.
def _extract_claims(markdown: str, *, cap: int = 40) -> list[str]:
    """Return up to ``cap`` declarative sentences from a markdown brief —
    the units the integrity gate audits for fabrication."""
    if not markdown:
        return []
    import re
    body = re.sub(r"```.*?```", " ", markdown, flags=re.DOTALL)   # strip code blocks
    claims: list[str] = []
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith("---"):
            continue
        line = re.sub(r"^[-*>\d.]+\s+", "", line)                 # strip bullet/quote markers
        for sent in re.split(r"(?<=[.!?])\s+", line):
            s = sent.strip()
            if 40 <= len(s) <= 400:
                claims.append(s)
                if len(claims) >= cap:
                    return claims
    return claims


def _integrity_limitations_md(integrity: dict, citations_check: dict) -> str:
    """Fold blocking integrity findings + unresolved citations into the
    Acknowledged Limitations body — never silently dropped."""
    lines: list[str] = []
    for f in (integrity or {}).get("blocking_findings", []) or []:
        if isinstance(f, dict):
            lines.append(f"- ⚠ **integrity ({f.get('mode', '?')})** — {f.get('note') or f.get('claim', '')[:120]}")
    miss = [c for c in (citations_check or {}).get("citations", []) or []
            if isinstance(c, dict) and c.get("status") == "missing"]
    for c in miss:
        lines.append(f"- ⚠ **unverified citation** — `{c.get('identifier', c.get('post_id', '?'))}` did not resolve in an external index.")
    return "\n".join(lines)


def _stage_receipt(name: str, ok: bool, summary: str, **extra: Any) -> dict:
    return {"name": name, "ok": bool(ok), "summary": summary, **extra}


def run_academic_brief(
    topic: str,
    *,
    query: str | None = None,
    provider: str | None = None,
    level: str = "L3",
    approved: bool = False,
    limit_per_source: int = 5,
    max_fulltext: int = 3,
    year_from: int | None = None,
    rounds: int = 1,
    dynamic_roles: bool = True,
    style: str = "IMRaD",
    export_format: str = "markdown",
    min_grounded: int = 2,
    on_stage: Callable[[str, dict], None] | None = None,
) -> dict[str, Any]:
    """Run the academic-mode pipeline. Always returns a dict; never raises for
    user-facing failures.

    Governance:
      - ``L1`` runs research + synthesize, then stops (suggests the rest).
      - ``L2`` runs through the grounding gate, then pauses for approval;
        re-invoke with ``approved=True`` to run peer_review + finalize.
      - ``L3`` (default) runs every stage end-to-end.
    """
    from ..core.db import record_check, record_lineage, record_academic_brief
    from .paper_pipeline import run_paper_research, paper_export_with_citations
    from .paper_analyze import analyze_papers_bulk, get_analyses
    from .paper_gaps import detect_gaps
    from .deliberate import generate_debate_roles
    from .academic_review import run_review_panel
    from .academic_integrity import run_integrity_check
    from .academic_citations import verify_citations
    from .academic_passport import append_passport, get_passport

    level = (level or "L3").upper()
    if level not in _VALID_LEVELS:
        level = "L3"
    run_id = uuid.uuid4().hex
    errors: list[str] = []
    stages: list[dict] = []

    def _emit(stage: str, payload: dict) -> None:
        if on_stage:
            try:
                on_stage(stage, {"run_id": run_id, **payload})
            except Exception:
                pass

    def _base(**extra: Any) -> dict:
        return {
            "topic": topic, "run_id": run_id, "level": level,
            "stages": stages, "errors": errors, "generated_at": _now_iso(),
            **extra,
        }

    def _passport(stage: str, payload: dict) -> None:
        """Append an append-only, hash-chained provenance entry. Best-effort."""
        try:
            append_passport(topic, run_id, stage, payload)
        except Exception:
            pass

    # ── Stage 1 — research ────────────────────────────────────────────────
    _emit("research", {"status": "start"})
    research, err = _safe_call(
        lambda: run_paper_research(
            topic, query=query, limit_per_source=limit_per_source,
            max_fulltext=max_fulltext, year_from=year_from, provider=provider,
        ),
        {"ok": False},
    )
    if err:
        errors.append(f"research: {err}")
    r_ok = bool(research.get("ok"))
    r_summary = (
        f"{research.get('search_total', 0)} found · "
        f"{research.get('analyzed', 0)} analyzed"
    )
    record_check(topic=topic, gate="academic_research", operation="run_paper_research",
                 passed=r_ok, run_id=run_id, detail=r_summary)
    record_lineage(topic=topic, artifact_id=f"academic_research:{run_id}",
                   artifact_kind="academic_stage", produced_by=run_id, decision="research")
    stages.append(_stage_receipt("research", r_ok, r_summary,
                                 by_source=research.get("by_source", {})))
    _passport("research", {"ok": r_ok, "summary": r_summary,
                           "by_source": research.get("by_source", {})})
    _emit("research", {"status": "done", "ok": r_ok, "summary": r_summary})

    # ── Stage 2 — synthesize (per-paper analysis + literature gaps) ───────
    _emit("synthesize", {"status": "start"})
    bulk, err = _safe_call(lambda: analyze_papers_bulk(topic), {"ok": False, "analyzed": 0})
    if err:
        errors.append(f"synthesize.analyze: {err}")
    gaps_res, err = _safe_call(lambda: detect_gaps(topic, provider=provider), {"ok": False, "gaps": []})
    if err:
        errors.append(f"synthesize.gaps: {err}")
    gaps = gaps_res.get("gaps", []) if isinstance(gaps_res, dict) else []
    analyses, err = _safe_call(lambda: get_analyses(topic), [])
    if err:
        errors.append(f"synthesize.analyses: {err}")
    s_summary = f"{len(analyses)} analyzed papers · {len(gaps)} literature gaps"
    s_ok = bool(bulk.get("ok"))
    record_check(topic=topic, gate="academic_synthesize", operation="analyze+gaps",
                 passed=s_ok, run_id=run_id, detail=s_summary)
    record_lineage(topic=topic, artifact_id=f"academic_synthesize:{run_id}",
                   artifact_kind="academic_stage", produced_by=run_id, decision="synthesize")
    stages.append(_stage_receipt("synthesize", s_ok, s_summary,
                                 gaps=len(gaps), analyzed=len(analyses)))
    _passport("synthesize", {"ok": s_ok, "summary": s_summary,
                             "gaps": len(gaps), "analyzed": len(analyses)})
    _emit("synthesize", {"status": "done", "ok": s_ok, "summary": s_summary})

    # ── Grounding gate (HARD BLOCK) ───────────────────────────────────────
    grounded_count = len(analyses)
    grounded_ok = grounded_count >= min_grounded
    record_check(topic=topic, gate="academic_grounding", operation="grounding",
                 passed=grounded_ok, run_id=run_id,
                 invariant=f"grounded_academic_papers>={min_grounded}",
                 detail=f"grounded={grounded_count} min={min_grounded}")
    _emit("grounding", {"status": "done", "grounded_count": grounded_count,
                        "min": min_grounded, "passed": grounded_ok})
    stages.append(_stage_receipt(
        "grounding", grounded_ok,
        f"{grounded_count}/{min_grounded} grounded academic papers",
        grounded_count=grounded_count, min_grounded=min_grounded))
    _passport("grounding", {"passed": grounded_ok, "grounded_count": grounded_count,
                            "min_grounded": min_grounded})

    if not grounded_ok:
        return _base(ok=False, stage="grounding", gate="coverage",
                     grounded_count=grounded_count, awaiting_approval=False,
                     peer_review=None, brief=None,
                     reason=(f"Only {grounded_count} grounded academic paper(s); "
                             f"need {min_grounded}. Collect/analyze more papers, then re-run."))

    # ── Governance pauses ─────────────────────────────────────────────────
    if level == "L1":
        return _base(ok=True, stage="synthesize", gate=None,
                     grounded_count=grounded_count, awaiting_approval=False,
                     suggested_next=["peer_review", "finalize"],
                     peer_review=None, brief=None,
                     reason="L1 (suggest): research + synthesize complete; run peer_review + finalize to continue.")
    if level == "L2" and not approved:
        return _base(ok=True, stage="grounding", gate=None,
                     grounded_count=grounded_count, awaiting_approval=True,
                     peer_review=None, brief=None,
                     reason="L2 (gated): grounding passed. Approve to run peer_review + finalize.")

    # ── Stage 3 — peer_review (multi-reviewer panel over the synthesis) ───
    # Upgrade from a single deliberation pass to a real EIC + methodology +
    # domain + perspective + devil's-advocate panel, each scoring 0–100, then
    # synthesized to an editorial decision.
    _emit("peer_review", {"status": "start"})
    items, err = _safe_call(lambda: _build_review_items(gaps, analyses), [])
    if err:
        errors.append(f"peer_review.items: {err}")
    roles = None
    if dynamic_roles:
        roles, err = _safe_call(lambda: generate_debate_roles(topic, provider=provider), None)
        if err:
            errors.append(f"peer_review.roles: {err}")
    review, err = _safe_call(
        lambda: run_review_panel(topic, items, provider=provider, rounds=rounds, roles=roles),
        {"ok": False, "editorial_decision": "major_revision", "dissent": [], "reviewers": []},
    )
    if err:
        errors.append(f"peer_review: {err}")
    pr_ok = bool(review.get("ok"))
    decision = review.get("editorial_decision", "major_revision")
    dissent = review.get("dissent", []) or []
    pr_summary = (
        f"{len(review.get('reviewers', []) or [])} reviewers · "
        f"decision={decision} · mean={review.get('mean_score', 0)} · "
        f"dissent={len(dissent)}"
    )
    record_check(topic=topic, gate="academic_peer_review", operation="review_panel",
                 passed=pr_ok, run_id=run_id,
                 invariant="editorial_decision_recorded", detail=pr_summary)
    record_lineage(topic=topic, artifact_id=f"academic_peer_review:{run_id}",
                   artifact_kind="academic_stage", produced_by=run_id, decision=decision)
    stages.append(_stage_receipt("peer_review", pr_ok, pr_summary,
                                 decision=decision, dissent=len(dissent),
                                 mean_score=review.get("mean_score", 0)))
    _passport("peer_review", {"ok": pr_ok, "decision": decision,
                              "mean_score": review.get("mean_score", 0),
                              "reviewers": [{"role": r.get("role"), "score": r.get("score"),
                                             "recommendation": r.get("recommendation")}
                                            for r in (review.get("reviewers", []) or [])],
                              "critical_blocks": bool(review.get("critical_blocks"))})
    _emit("peer_review", {"status": "done", "ok": pr_ok, "summary": pr_summary,
                          "decision": decision})

    # ── Stage 4 — finalize (cited brief, grounded-only citations) ─────────
    _emit("finalize", {"status": "start"})
    export, err = _safe_call(
        lambda: paper_export_with_citations(topic, provider=provider, format="markdown", style=style),
        {"ok": False},
    )
    if err:
        errors.append(f"finalize: {err}")
    f_ok = bool(export.get("ok"))
    markdown = export.get("content", "") if f_ok else ""
    limitations = _limitations_md(review)
    # Anti-fabrication: citations are restricted to committed academic papers.
    citations = [a.get("post_id") for a in analyses if a.get("post_id")]
    f_summary = f"{len(markdown)} chars · {len(citations)} grounded citations"
    record_check(topic=topic, gate="academic_finalize", operation="paper_export",
                 passed=f_ok, run_id=run_id,
                 invariant="citations_subset_committed_academic",
                 detail=f_summary)
    record_lineage(topic=topic, artifact_id=f"academic_brief:{run_id}",
                   artifact_kind="academic_brief", produced_by=run_id,
                   from_post_ids=citations, decision="finalize")
    stages.append(_stage_receipt("finalize", f_ok, f_summary, citations=len(citations)))
    _passport("finalize", {"ok": f_ok, "chars": len(markdown),
                           "citations": len(citations)})
    _emit("finalize", {"status": "done", "ok": f_ok, "summary": f_summary})

    # ── Gate — integrity (7-mode AI-failure checklist over the brief) ─────
    _emit("integrity", {"status": "start"})
    claims = _extract_claims(markdown)
    integrity, err = _safe_call(
        lambda: run_integrity_check(topic, markdown, claims, provider=provider, final=True),
        {"ok": False, "verdict": "PASS", "blocking": False, "blocking_findings": []},
    )
    if err:
        errors.append(f"integrity: {err}")
    integ_blocking = bool(integrity.get("blocking"))
    integ_summary = (
        f"{integrity.get('verdict', 'PASS')} · "
        f"{integrity.get('sampled', 0)}/{integrity.get('total', len(claims))} claims · "
        f"blocking={integ_blocking}"
    )
    record_check(topic=topic, gate="academic_integrity", operation="integrity_check",
                 passed=not integ_blocking, run_id=run_id,
                 invariant="no_blocking_fabrication_modes", detail=integ_summary)
    stages.append(_stage_receipt("integrity", not integ_blocking, integ_summary,
                                 verdict=integrity.get("verdict", "PASS"),
                                 blocking=integ_blocking))
    _passport("integrity", {"verdict": integrity.get("verdict", "PASS"),
                            "blocking": integ_blocking,
                            "blocking_findings": integrity.get("blocking_findings", [])})
    _emit("integrity", {"status": "done", "ok": not integ_blocking, "summary": integ_summary,
                        "verdict": integrity.get("verdict", "PASS"), "blocking": integ_blocking})

    # ── Gate — citation existence (deterministic, 4-index verification) ────
    _emit("citation", {"status": "start"})
    citations_check, err = _safe_call(
        lambda: verify_citations(citations),
        {"ok": True, "blocking": False, "verified": 0, "missing": 0,
         "unresolvable": len(citations), "total": len(citations), "citations": []},
    )
    if err:
        errors.append(f"citation: {err}")
    cite_blocking = bool(citations_check.get("blocking"))
    cite_summary = (
        f"verified={citations_check.get('verified', 0)} · "
        f"missing={citations_check.get('missing', 0)} · "
        f"unresolvable={citations_check.get('unresolvable', 0)}"
    )
    record_check(topic=topic, gate="academic_citation", operation="verify_citations",
                 passed=not cite_blocking, run_id=run_id,
                 invariant="no_unresolved_doi", detail=cite_summary)
    stages.append(_stage_receipt("citation", not cite_blocking, cite_summary,
                                 blocking=cite_blocking,
                                 verified=citations_check.get("verified", 0),
                                 missing=citations_check.get("missing", 0)))
    _passport("citation", {"blocking": cite_blocking,
                           "verified": citations_check.get("verified", 0),
                           "missing": citations_check.get("missing", 0),
                           "unresolvable": citations_check.get("unresolvable", 0)})
    _emit("citation", {"status": "done", "ok": not cite_blocking, "summary": cite_summary,
                       "blocking": cite_blocking})

    # Fold integrity / citation flags into Acknowledged Limitations — never dropped.
    gate_extra = _integrity_limitations_md(integrity, citations_check)
    if gate_extra:
        limitations = (limitations + "\n" + gate_extra).strip() if limitations else gate_extra
    if markdown and limitations:
        markdown = (markdown.rstrip()
                    + "\n\n---\n\n## Acknowledged Limitations\n\n"
                    + limitations + "\n")

    # Overall gate status: a hard integrity block flags the brief (still
    # persisted + returned so the user sees what was caught), citation misses
    # are advisory (precision-over-recall — they only flag, never erase).
    blocked = integ_blocking or cite_blocking
    gate_status = "blocked" if integ_blocking else ("flagged" if cite_blocking else "passed")

    brief = {
        "markdown": markdown,
        "format": export_format,
        "path": None,
        "limitations": limitations,
        "citations": citations,
    }
    record_academic_brief(
        topic=topic, run_id=run_id, level=level, gate_status=gate_status,
        grounded_count=grounded_count, stages=stages, markdown=markdown,
        fmt=export_format, export_path=None, limitations=limitations,
        citations=citations, generated_at=_now_iso(),
        review_decision=decision,
        integrity_verdict=integrity.get("verdict", "PASS"),
        citations_verified=citations_check.get("verified", 0),
    )

    # Passport head for cross-session resume / provenance display.
    passport_view, _ = _safe_call(lambda: get_passport(run_id=run_id), {})
    passport_summary = {
        "length": len(passport_view.get("entries", []) or []),
        "verified": bool(passport_view.get("verified")),
        "head_hash": (passport_view.get("entries", []) or [{}])[-1].get("entry_hash", "")
        if passport_view.get("entries") else "",
    }

    return _base(ok=(f_ok and not integ_blocking), stage="finalize",
                 gate=("integrity" if integ_blocking else ("citation" if cite_blocking else None)),
                 grounded_count=grounded_count, awaiting_approval=False, blocked=blocked,
                 gate_status=gate_status,
                 peer_review={"decision": decision,
                              "mean_score": review.get("mean_score", 0),
                              "dissent_count": len(dissent),
                              "critical_blocks": bool(review.get("critical_blocks")),
                              "reviewers": [{"role": r.get("role"), "score": r.get("score"),
                                             "recommendation": r.get("recommendation")}
                                            for r in (review.get("reviewers", []) or [])]},
                 review=review,
                 integrity={"verdict": integrity.get("verdict", "PASS"),
                            "blocking": integ_blocking,
                            "sampled": integrity.get("sampled", 0),
                            "total": integrity.get("total", len(claims)),
                            "blocking_findings": integrity.get("blocking_findings", [])},
                 citations_check={"verified": citations_check.get("verified", 0),
                                  "missing": citations_check.get("missing", 0),
                                  "unresolvable": citations_check.get("unresolvable", 0),
                                  "blocking": cite_blocking,
                                  "citations": citations_check.get("citations", [])},
                 passport=passport_summary,
                 brief=brief)


def get_academic_brief(topic: str) -> dict[str, Any]:
    """Return the latest stored academic brief for ``topic`` (UI reader)."""
    from ..core.db import get_academic_brief as _get
    return _get(topic)
