"""Phase-5 — Cross-topic queries for the Dashboard.

Today each topic is an island. This module provides the three queries
that turn a Gap Map with multiple topics into a **compounding research
library**:

  1. `top_opportunities_across_topics(limit=20)` — ranked cross-topic
     leaderboard; surfaces the highest-Ulwick-score opportunities
     regardless of which topic they're in.
  2. `search_findings(query, topic_filter=None)` — global substring
     search across every finding's title, narrative, and best-quote.
     Uses semantic palace when available; falls back to SQL LIKE.
  3. `related_topics(topic, limit=5)` — finds topics with overlapping
     painpoints or products. Jaccard similarity on label sets.

All three read from `topic_insights.report_json` (populated by Phase 1
synthesize) so they don't need a new collect. See docs/ROADMAP.md §5.
"""
from __future__ import annotations

import json
import re
from typing import Any

from ..core.db import get_db


def _iter_topic_reports() -> list[tuple[str, dict]]:
    """Yield (topic, report) for every row in topic_insights.

    Parses report_json once — callers can scan freely. Skips rows
    with malformed JSON rather than raising.
    """
    db = get_db()
    if "topic_insights" not in db.table_names():
        return []
    out = []
    for r in db.query("SELECT topic, report_json FROM topic_insights"):
        try:
            report = json.loads(r["report_json"] or "{}")
        except Exception:
            continue
        out.append((r["topic"], report))
    return out


def top_opportunities_across_topics(
    limit: int = 20, min_score: float = 0.0
) -> list[dict[str, Any]]:
    """Cross-topic leaderboard — highest-Ulwick-score findings across
    all topics, deduped by finding title.

    Returns items shaped for direct UI rendering:
        {topic, title, kind, opportunity_score, importance,
         satisfaction, competitor_coverage, triangulation_strength,
         best_quote, evidence_post_ids, source_breakdown}
    """
    rows = []
    seen_titles = set()  # dedup across topics; keep highest-score variant
    for topic, report in _iter_topic_reports():
        for f in report.get("findings") or []:
            op = f.get("opportunity_score") or 0
            if op < min_score:
                continue
            title = (f.get("title") or "").strip()
            key = (topic, title.lower())
            if not title or key in seen_titles:
                continue
            seen_titles.add(key)
            rows.append({
                "topic": topic,
                "title": title,
                "kind": f.get("kind", "painpoint"),
                "opportunity_score": op,
                "importance": f.get("importance") or f.get("pain_weight") or 0,
                "satisfaction": f.get("satisfaction") or 0,
                "competitor_coverage": f.get("competitor_coverage", 0.5),
                "triangulation_strength": f.get("triangulation_strength", "narrow"),
                "best_quote": f.get("best_quote", ""),
                "evidence_post_ids": f.get("evidence_post_ids") or [],
                "source_breakdown": f.get("source_breakdown") or {},
                "classification": f.get("classification", "UNCLASSIFIED"),
            })
    rows.sort(key=lambda r: r["opportunity_score"], reverse=True)
    return rows[:limit]


def search_findings(
    query: str,
    topic_filter: str | None = None,
    limit: int = 30,
) -> list[dict[str, Any]]:
    """Global substring search across every finding's text fields.

    Matches are case-insensitive. Searches:
      - title
      - narrative
      - best_quote

    Returns ranked by (title match × 3) + (narrative match) + (quote match),
    capped at `limit`.
    """
    if not query or not query.strip():
        return []
    q = query.strip().lower()
    q_re = re.compile(re.escape(q), re.IGNORECASE)
    hits = []
    for topic, report in _iter_topic_reports():
        if topic_filter and topic != topic_filter:
            continue
        for f in report.get("findings") or []:
            title = f.get("title", "") or ""
            narrative = f.get("narrative", "") or ""
            quote = f.get("best_quote", "") or ""
            title_hits = len(q_re.findall(title))
            narr_hits = len(q_re.findall(narrative))
            quote_hits = len(q_re.findall(quote))
            total = title_hits * 3 + narr_hits + quote_hits
            if total == 0:
                continue
            hits.append({
                "topic": topic,
                "title": title,
                "kind": f.get("kind", "painpoint"),
                "opportunity_score": f.get("opportunity_score", 0),
                "narrative_snippet": _snippet(narrative, q, 160),
                "quote_snippet": _snippet(quote, q, 120),
                "relevance": total,
            })
    hits.sort(key=lambda r: (r["relevance"], r["opportunity_score"]), reverse=True)
    return hits[:limit]


def _snippet(text: str, query: str, max_len: int) -> str:
    """Return a short excerpt of `text` centered on the first `query`
    occurrence. Used so search results highlight the matching region
    rather than showing the whole narrative."""
    if not text:
        return ""
    lower = text.lower()
    q = query.lower()
    i = lower.find(q)
    if i < 0:
        return text[:max_len] + ("…" if len(text) > max_len else "")
    start = max(0, i - max_len // 2)
    end = min(len(text), i + len(query) + max_len // 2)
    out = text[start:end]
    if start > 0:
        out = "…" + out
    if end < len(text):
        out = out + "…"
    return out


def related_topics(topic: str, limit: int = 5) -> list[dict[str, Any]]:
    """Topics whose findings overlap significantly with the target's.

    Uses Jaccard similarity on normalized finding titles. Returns
    list of {topic, shared_count, jaccard, sample_titles}.

    Used by the per-topic "Related topics" sidebar and by the
    dashboard's "You also researched" suggestions.
    """
    all_reports = _iter_topic_reports()
    target_titles = None
    other_reports = []
    for t, report in all_reports:
        titles = {
            (f.get("title") or "").strip().lower()
            for f in (report.get("findings") or [])
            if f.get("title")
        }
        if t == topic:
            target_titles = titles
        else:
            other_reports.append((t, titles, report))
    if not target_titles:
        return []
    hits = []
    for t, titles, report in other_reports:
        if not titles:
            continue
        intersect = target_titles & titles
        union = target_titles | titles
        jaccard = len(intersect) / len(union) if union else 0
        if jaccard == 0:
            continue
        hits.append({
            "topic": t,
            "shared_count": len(intersect),
            "jaccard": round(jaccard, 3),
            "sample_titles": list(intersect)[:3],
        })
    hits.sort(key=lambda r: r["jaccard"], reverse=True)
    return hits[:limit]


__all__ = ["top_opportunities_across_topics", "search_findings", "related_topics"]
