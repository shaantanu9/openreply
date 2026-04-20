"""Phase-1 Insight Engine — one long-context Claude call that produces a
structured market report from the full multi-source corpus.

Contrast with `gaps.py` (the legacy extractor pipeline):
  - gaps.py runs 4 separate LLM calls (painpoints / features / complaints / diy)
    on 50-post batches. Each call sees only a narrow slice.
  - insights.py packs ~1500-2000 posts across all source types into ONE call,
    asks Claude to SYNTHESIZE across sources, and returns a single coherent
    JSON report with opportunity scoring + competitor landscape + quadrant.

Spec: docs/specs/2026-04-20-insight-engine.md (Phase 1).
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from ..analyze.providers.base import resolve_provider
from ..core.db import get_db
from .corpus_format import format_corpus as _format_corpus
from .prompts import load_extractor


# Per-source sampling caps. Balances representation so Reddit's 80%+ post
# count doesn't drown academic papers or app-store reviews. Tuned for the
# ~200K-token budget (1M context capable but prompt caching is cheaper on
# smaller prompts). Env overrides let heavy users push limits up.
_PER_SOURCE_CAPS = {
    "reddit":        int(os.getenv("INSIGHTS_CAP_REDDIT", "80")),
    "hn":            int(os.getenv("INSIGHTS_CAP_HN", "40")),
    "appstore":      int(os.getenv("INSIGHTS_CAP_APPSTORE", "40")),
    "playstore":     int(os.getenv("INSIGHTS_CAP_PLAYSTORE", "40")),
    "arxiv":         int(os.getenv("INSIGHTS_CAP_ARXIV", "30")),
    "openalex":      int(os.getenv("INSIGHTS_CAP_OPENALEX", "20")),
    "pubmed":        int(os.getenv("INSIGHTS_CAP_PUBMED", "20")),
    "scholar":       int(os.getenv("INSIGHTS_CAP_SCHOLAR", "20")),
    "gnews":         int(os.getenv("INSIGHTS_CAP_GNEWS", "15")),
    "devto":         int(os.getenv("INSIGHTS_CAP_DEVTO", "15")),
    "stackoverflow": int(os.getenv("INSIGHTS_CAP_SO", "15")),
    "github":        int(os.getenv("INSIGHTS_CAP_GITHUB", "10")),
    "ingest":        int(os.getenv("INSIGHTS_CAP_INGEST", "30")),
}
# Hard upper bound on total selected posts — keeps token cost bounded even
# if every cap above is cranked up. Claude 4.7 (1M ctx) handles 2000
# comfortably; narrowed per-provider below.
_HARD_CAP = int(os.getenv("INSIGHTS_HARD_CAP", "2000"))

# Provider-adaptive corpus caps. Our full prompt at HARD_CAP=2000 is
# ~200K input tokens. Any provider with <200K context window needs a
# smaller slice OR we'll hit "context_length_exceeded" at runtime. These
# caps are conservative (target ≤ 50% of context window so response +
# system + user template + output still fit).
#
# Override any of these with INSIGHTS_HARD_CAP=N env var if you know
# your model can take more.
_PROVIDER_CAPS = {
    "anthropic":  2000,  # 1M ctx (Opus 4.7) — full budget
    "openai":     1500,  # GPT-4 128K ctx — still plenty
    "openrouter": 1500,  # routes to any — conservative default
    "google":     2000,  # Gemini 1M+ ctx
    "groq":        300,  # ~32K ctx on most models
    "deepseek":    800,  # ~128K on DeepSeek-V3
    "mistral":     600,  # ~128K on large
    "ollama":      100,  # 8K–32K typical — small local models
}


def _cap_for_provider(provider: str) -> int:
    """Return the corpus cap appropriate for this provider's context window.
    Env override `INSIGHTS_HARD_CAP` wins if set — for power users with big
    local models (e.g. llama3.1:70b on a GPU with 128K context)."""
    env_override = os.getenv("INSIGHTS_HARD_CAP")
    if env_override and env_override.isdigit():
        return int(env_override)
    return _PROVIDER_CAPS.get(provider, 800)


def _select_corpus(topic: str, min_score: int = 0) -> list[dict[str, Any]]:
    """Pull a balanced sample of posts across source types for `topic`.

    Per-source ordering: (score + 2 × num_comments) DESC so high-engagement
    posts surface first. Academic sources (arxiv/openalex/pubmed/scholar)
    bypass the min_score filter because their native scores are meaningless
    (citation counts aren't populated in our schema).

    Returns list of dicts ready for `format_corpus`.
    """
    db = get_db()
    selected: list[dict[str, Any]] = []
    academic = {"arxiv", "openalex", "pubmed", "scholar"}

    # Get the distinct source types present for this topic first — avoids
    # running N SQL queries for sources we don't have data from.
    present = [
        r["src"] for r in db.query(
            "SELECT DISTINCT coalesce(p.source_type, 'reddit') AS src "
            "FROM topic_posts tp JOIN posts p ON p.id = tp.post_id "
            "WHERE tp.topic = ?",
            [topic],
        )
    ]

    for src in present:
        cap = _PER_SOURCE_CAPS.get(src, 15)
        # Academic sources: ignore score floor. Reddit: honour min_score.
        score_clause = "" if src in academic else "AND p.score >= :min_score"
        rows = list(db.query(
            f"""
            SELECT p.id, p.sub, p.author, p.title,
                   substr(p.selftext, 1, 600) AS selftext,
                   p.score, p.num_comments, p.created_utc,
                   coalesce(p.source_type, 'reddit') AS source_type
            FROM topic_posts tp
            JOIN posts p ON p.id = tp.post_id
            WHERE tp.topic = :topic
              AND coalesce(p.source_type, 'reddit') = :src
              {score_clause}
            ORDER BY (coalesce(p.score,0) + 2 * coalesce(p.num_comments,0)) DESC
            LIMIT :cap
            """,
            {"topic": topic, "src": src, "min_score": min_score, "cap": cap},
        ))
        selected.extend(rows)

    # Apply hard cap on the union. Keeps highest-score posts across sources.
    if len(selected) > _HARD_CAP:
        selected.sort(
            key=lambda r: (r.get("score") or 0) + 2 * (r.get("num_comments") or 0),
            reverse=True,
        )
        selected = selected[:_HARD_CAP]

    return selected


def _parse_insight_json(raw: str) -> dict:
    """Parse Claude's JSON output. Strip code fences if present; tolerate
    a leading preamble sentence the model occasionally emits despite the
    'JSON only' instruction."""
    cleaned = raw.strip()
    for fence in ("```json", "```"):
        if cleaned.startswith(fence):
            cleaned = cleaned[len(fence):].lstrip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()
    # If the model emitted preamble, find the first {.
    if not cleaned.startswith("{"):
        brace = cleaned.find("{")
        if brace >= 0:
            cleaned = cleaned[brace:]
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        return {"_parse_error": True, "_raw": raw[:2000], "_error": str(e)}


def _ensure_topic_insights_table() -> None:
    """One row per topic, overwritten on re-run. Schema mirrors spec Phase 1."""
    db = get_db()
    if "topic_insights" in db.table_names():
        return
    db["topic_insights"].create(
        {
            "topic": str,
            "report_json": str,
            "generated_at": str,
            "corpus_size": int,
            "provider": str,
            "model": str,
        },
        pk="topic",
    )


def _persist(topic: str, report: dict, provider: str, model: str, corpus_size: int) -> None:
    _ensure_topic_insights_table()
    db = get_db()
    db["topic_insights"].upsert(
        {
            "topic": topic,
            "report_json": json.dumps(report, ensure_ascii=False, default=str),
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "corpus_size": corpus_size,
            "provider": provider,
            "model": model,
        },
        pk="topic",
    )


def synthesize_insights(
    topic: str,
    provider: str | None = None,
    persist: bool = True,
    min_score: int = 0,
) -> dict[str, Any]:
    """Run the one-shot synthesis call and return the parsed report.

    Graceful-skip when no LLM is configured (returns `{ok:False, skipped:True,
    reason}`) so the UI never raises on an unconfigured collect.
    """
    try:
        provider = resolve_provider(provider)
    except RuntimeError as e:
        return {
            "ok": False, "skipped": True, "topic": topic,
            "reason": str(e),
        }

    rows = _select_corpus(topic, min_score=min_score)
    if not rows:
        return {
            "ok": False,
            "topic": topic,
            "error": f"No corpus for topic={topic!r}. Run `research collect` first.",
        }

    # Trim corpus to what the provider's context window can swallow.
    # Keeps highest-engagement posts; drops the long tail that small
    # models would truncate anyway. See `_cap_for_provider` for rationale.
    provider_cap = _cap_for_provider(provider)
    if len(rows) > provider_cap:
        rows.sort(
            key=lambda r: (r.get("score") or 0) + 2 * (r.get("num_comments") or 0),
            reverse=True,
        )
        rows = rows[:provider_cap]

    ext = load_extractor("insights_synthesis")
    sources_present = sorted({r.get("source_type") or "reddit" for r in rows})
    corpus_text = _format_corpus(rows)
    user_prompt = ext["user_template"].format(
        topic=topic,
        corpus=corpus_text,
        corpus_size=len(rows),
        source_count=len(sources_present),
    )

    # Claude Opus 4.7 for best synthesis quality. Fall back to the provider's
    # default model if the user has overridden. max_tokens=8000 covers 15
    # findings + quadrant + competitor list + narrative comfortably.
    from ..analyze.providers.base import get_provider
    prov = get_provider(provider)
    # Attempt to pin a high-quality Claude model when on Anthropic. Everyone
    # else gets their default (OpenRouter user can select Claude via LLM_MODEL).
    try:
        raw = prov.complete(
            prompt=user_prompt,
            system=ext["system"],
            max_tokens=8000,
            temperature=0.2,
        )
    except Exception as e:
        return {"ok": False, "topic": topic, "error": f"LLM call failed: {e}"}

    report = _parse_insight_json(raw)
    if report.get("_parse_error"):
        return {
            "ok": False,
            "topic": topic,
            "error": f"Failed to parse LLM JSON: {report.get('_error')}",
            "raw_preview": report.get("_raw", "")[:500],
        }

    # Stamp metadata from the pipeline — Claude sometimes omits corpus_coverage
    # despite the schema, so we overwrite with ground truth.
    report["corpus_coverage"] = {
        "total_posts_considered": len(rows),
        "sources_represented": sources_present,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    report["ok"] = True
    report["topic"] = topic
    report["provider"] = provider

    # Optional post-processing: clamp scores, fill opportunity_score if missing
    _normalize_scores(report)

    if persist:
        model = os.getenv("LLM_MODEL") or getattr(prov, "_model", "") or ""
        _persist(topic, report, provider, model, len(rows))

    return report


def _normalize_scores(report: dict) -> None:
    """Clamp pain_weight / competitor_coverage / opportunity_score to valid
    ranges. Re-compute opportunity_score if the model returned an outlier
    that violates the rubric."""
    for f in report.get("findings") or []:
        pw = _clamp(f.get("pain_weight"), 0, 10, default=5.0)
        cc = _clamp(f.get("competitor_coverage"), 0.0, 1.0, default=0.5)
        acad = 1 if (f.get("academic_backing") or []) else 0
        # If the model produced a score outside [0,10] or missing, recompute.
        raw_op = f.get("opportunity_score")
        if not isinstance(raw_op, (int, float)) or raw_op < 0 or raw_op > 10:
            op = pw * (1 - cc) * (1 + 0.2 * acad)
        else:
            op = raw_op
        f["pain_weight"] = round(pw, 1)
        f["competitor_coverage"] = round(cc, 2)
        f["opportunity_score"] = round(_clamp(op, 0, 10, default=pw * (1 - cc)), 1)


def _clamp(v: Any, lo: float, hi: float, default: float) -> float:
    try:
        fv = float(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, fv))


def load_insights(topic: str) -> dict | None:
    """Fetch the cached insight report for a topic. None if never generated."""
    _ensure_topic_insights_table()
    db = get_db()
    rows = list(db.query(
        "SELECT report_json, generated_at, corpus_size, provider, model "
        "FROM topic_insights WHERE topic = ?",
        [topic],
    ))
    if not rows:
        return None
    r = rows[0]
    try:
        report = json.loads(r["report_json"])
    except Exception:
        return None
    report["_cached"] = True
    report["_generated_at"] = r.get("generated_at")
    report["_corpus_size"] = r.get("corpus_size")
    report["_provider"] = r.get("provider")
    report["_model"] = r.get("model")
    return report


__all__ = ["synthesize_insights", "load_insights", "_select_corpus"]
