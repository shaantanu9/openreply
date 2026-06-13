"""One-call "build the paper knowledge base for a topic" orchestrator.

Chains the previously-separate manual steps into a single resumable pipeline
so the desktop app can drive the whole flow from one button:

    1. fulltext   — download + cache the PDF/JATS full text for every paper
                    (get_full_text also auto-indexes sections/chunks/refs)
    2. summarize  — per-paper LLM summary (summary / relevance / takeaway)
    3. relations  — paper↔paper edges (semantic / cites / shared-finding / author)
    4. gaps       — detect + persist research gaps (4 kinds) into paper_gaps
    5. insights   — synthesize corpus findings (prereq for draft generation)

Every stage reuses the existing, individually-tested implementation; this
module only adds the chaining + a uniform progress callback so a streaming
caller (CLI ``--stream`` → Tauri events) can show live per-stage counts.

The pipeline is *resumable*: each stage skips work already done (cached full
text, existing analyses, existing edges), so stopping and re-running is cheap
and safe. Pass ``force=True`` to redo summaries + gaps.

``progress_cb(event, payload)`` events emitted (mirrors the enrich stream):
    ("workflow:start", {topic, papers, scope, stages})
    ("stage:start",    {stage, label})
    ("stage:progress", {stage, done, total, msg})
    ("stage:done",     {stage, result})
    ("workflow:done",  {summary})

Never raises — a stage that errors is recorded in the summary and the
pipeline continues to the next stage.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from .paper_export import _papers_for_topic

ProgressCb = Callable[[str, dict], None]

# scope → how many papers (most-cited first) to process. None == all.
_SCOPE_LIMITS = {"all": None, "top50": 50, "top25": 25, "abstracts": None}

# Ordered stage list with display labels.
_STAGES = [
    ("fulltext", "Downloading full text"),
    ("embed", "Embedding papers for chat & relations"),
    ("summarize", "Summarizing papers"),
    ("relations", "Building paper relations"),
    ("gaps", "Detecting patterns & gaps"),
    ("insights", "Synthesizing insights"),
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _safe(cb: ProgressCb | None, event: str, payload: dict) -> None:
    if not cb:
        return
    try:
        cb(event, payload)
    except Exception:
        pass


def build_paper_knowledge(
    topic: str,
    *,
    scope: str = "all",
    provider: str | None = None,
    force: bool = False,
    progress_cb: ProgressCb | None = None,
) -> dict[str, Any]:
    """Run the full paper-knowledge pipeline for ``topic``. See module docstring.

    ``scope`` ∈ {all, top50, top25, abstracts}. ``abstracts`` skips the
    full-text download stage (summaries/gaps run on abstracts only — cheapest).
    Returns ``{ok, topic, scope, stages:{name:result}, errors:[...]}``.
    """
    scope = (scope or "all").lower()
    if scope not in _SCOPE_LIMITS:
        scope = "all"
    limit = _SCOPE_LIMITS[scope]
    skip_fulltext = scope == "abstracts"

    papers = _papers_for_topic(topic, limit=limit)
    total_papers = len(papers)
    stage_names = [s for s in _STAGES if not (skip_fulltext and s[0] == "fulltext")]

    _safe(progress_cb, "workflow:start", {
        "topic": topic, "papers": total_papers, "scope": scope,
        "stages": [s[0] for s in stage_names],
    })

    if total_papers == 0:
        summary = {"ok": False, "topic": topic, "scope": scope,
                   "reason": "no academic papers tagged to this topic — collect papers first",
                   "stages": {}, "errors": []}
        _safe(progress_cb, "workflow:done", {"summary": summary})
        return summary

    stages: dict[str, Any] = {}
    errors: list[dict] = []

    def run_stage(name: str, label: str, fn) -> Any:
        _safe(progress_cb, "stage:start", {"stage": name, "label": label})
        try:
            res = fn()
            stages[name] = res
            _safe(progress_cb, "stage:done", {"stage": name, "result": res})
            return res
        except Exception as e:  # fail-soft: record + continue
            err = {"stage": name, "error": f"{type(e).__name__}: {e}"}
            errors.append(err)
            stages[name] = {"ok": False, **err}
            _safe(progress_cb, "stage:done", {"stage": name, "result": stages[name]})
            return stages[name]

    # ── 1. full text ────────────────────────────────────────────────────
    if not skip_fulltext:
        def _fulltext():
            from .paper_fulltext import fetch_bulk

            def _p(i, tot, pid, status):
                _safe(progress_cb, "stage:progress",
                      {"stage": "fulltext", "done": i, "total": tot,
                       "msg": f"{i}/{tot} {status}"})
            return fetch_bulk(topic=topic, limit=limit, progress=_p)
        run_stage("fulltext", "Downloading full text", _fulltext)

    # ── 1b. embed (abstract fallback) ───────────────────────────────────
    # Full text exists for <10% of papers (rest are paywalled). Embed the
    # abstract of every other paper as a single chunk so the WHOLE corpus is
    # chat-able (paper_qa) and relatable (paper_neighbors). Local-CPU +
    # idempotent; skips papers that already have full-text chunks. Runs before
    # `relations` so the semantic edge build sees every paper's vector.
    def _embed():
        from .paper_chunks import chunk_abstracts_all

        def _p(msg):
            _safe(progress_cb, "stage:progress",
                  {"stage": "embed", "msg": str(msg)[:160]})
        _p("embedding abstracts for papers without full text…")
        return chunk_abstracts_all(topic, embed=True, limit=limit, force=force)
    run_stage("embed", "Embedding papers for chat & relations", _embed)

    # ── 2. summaries ────────────────────────────────────────────────────
    def _summarize():
        from .paper_analyze import analyze_papers_bulk

        def _p(msg):
            _safe(progress_cb, "stage:progress",
                  {"stage": "summarize", "msg": str(msg)[:160]})
        return analyze_papers_bulk(topic, limit=limit, force=force, progress=_p)
    run_stage("summarize", "Summarizing papers", _summarize)

    # ── 3. relations ────────────────────────────────────────────────────
    def _relations():
        from . import paper_relations
        return paper_relations.build(topic=topic, force=force)
    run_stage("relations", "Building paper relations", _relations)

    # ── 4. gaps ─────────────────────────────────────────────────────────
    def _gaps():
        from .paper_gaps import detect_gaps

        def _p(event, info):
            _safe(progress_cb, "stage:progress",
                  {"stage": "gaps", "msg": f"{event} {info}"[:160]})
        return detect_gaps(topic, provider=provider, force=force, progress_cb=_p)
    run_stage("gaps", "Detecting patterns & gaps", _gaps)

    # ── 5. insights ─────────────────────────────────────────────────────
    def _insights():
        from .insights import synthesize_insights
        return synthesize_insights(topic=topic, provider=provider, persist=True)
    run_stage("insights", "Synthesizing insights", _insights)

    summary = {
        "ok": True,
        "topic": topic,
        "scope": scope,
        "papers": total_papers,
        "stages": stages,
        "errors": errors,
        "generated_at": _now_iso(),
    }
    _safe(progress_cb, "workflow:done", {"summary": summary})
    return summary


__all__ = ["build_paper_knowledge"]
