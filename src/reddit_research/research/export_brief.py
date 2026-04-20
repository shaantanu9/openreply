"""Phase-7 — Shareable brief exports.

Turns a `topic_insights` report into formats the user can share:
  - Minto-structured markdown (paste into Notion / Linear / email)
  - Standalone hypothesis-card markdown (one per tracked bet)
  - Plain-text executive summary (for Slack / DMs)

All three read from already-persisted state (`topic_insights`,
`hypothesis_tests`) so they're cheap and do not re-call the LLM.

Why markdown + not PDF: PDF adds weasyprint or reportlab (~30 MB
to the PyInstaller sidecar). Notion/Linear/Slack/email all render
markdown natively. Users who need PDF can print-to-PDF from a
markdown preview. If demand emerges we add PDF later.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db


def _fmt_pct(x: float | int | None) -> str:
    if x is None:
        return "—"
    return f"{float(x):.1f}"


def _load_report(topic: str) -> dict | None:
    db = get_db()
    if "topic_insights" not in db.table_names():
        return None
    rows = list(db.query(
        "SELECT report_json FROM topic_insights WHERE topic = ?",
        [topic],
    ))
    if not rows:
        return None
    try:
        return json.loads(rows[0]["report_json"] or "{}")
    except Exception:
        return None


def export_markdown(topic: str, include_hypotheses: bool = True) -> str:
    """Return a Minto-structured markdown brief for `topic`.

    Paste-ready for Notion / Linear / email. Includes:
      - Governing thought (headline)
      - Three key arguments with evidence
      - Opportunity quadrant summary
      - Top 10 findings with Ulwick scores + source badges
      - Competitor list with features/weaknesses
      - (Optional) top 5 hypothesis cards
      - Corpus coverage stats

    Returns empty string if no synthesis has run for this topic.
    """
    report = _load_report(topic)
    if not report:
        return f"# Gap Map brief — {topic}\n\n(No insights generated yet for this topic. Run the Insights tab first.)\n"

    out = []
    out.append(f"# {topic}")
    out.append(f"_Gap Map brief · {datetime.now(timezone.utc).strftime('%Y-%m-%d')}_\n")

    # § Minto governing thought + arguments
    gt = (report.get("governing_thought") or "").strip()
    if gt:
        out.append("## The answer")
        out.append(f"**{gt}**\n")
    args = report.get("key_arguments") or []
    if args:
        out.append("### Three supporting arguments")
        for i, a in enumerate(args, 1):
            claim = (a.get("claim") or "").strip()
            ev = a.get("evidence_post_ids") or []
            ev_str = f" _({len(ev)} citations)_" if ev else ""
            out.append(f"{i}. {claim}{ev_str}")
        out.append("")

    # § Executive summary (full paragraph form)
    summary = (report.get("executive_summary") or "").strip()
    if summary:
        out.append("## Executive summary")
        out.append(summary + "\n")

    # § Top opportunities
    findings = sorted(
        report.get("findings") or [],
        key=lambda f: f.get("opportunity_score", 0),
        reverse=True,
    )[:10]
    if findings:
        out.append("## Top opportunities (Ulwick-scored)")
        out.append("| Rank | Title | Opp | Importance | Satisfaction | Coverage | Classification |")
        out.append("|---|---|---|---|---|---|---|")
        for i, f in enumerate(findings, 1):
            out.append(
                f"| {i} | {f.get('title','')} "
                f"| **{_fmt_pct(f.get('opportunity_score'))}/20** "
                f"| {_fmt_pct(f.get('importance') or f.get('pain_weight'))} "
                f"| {_fmt_pct(f.get('satisfaction'))} "
                f"| {f.get('competitor_coverage', 0.5):.2f} "
                f"| {f.get('classification', 'UNCLASSIFIED')} |"
            )
        out.append("")

        # § Per-finding cards with quote + sources
        for f in findings:
            out.append(f"### {f.get('title', '(untitled)')}")
            score = _fmt_pct(f.get("opportunity_score"))
            triang = f.get("triangulation_strength", "narrow")
            out.append(f"_Opportunity **{score}/20** · triangulation: {triang}_\n")
            narr = (f.get("narrative") or "").strip()
            if narr:
                out.append(narr + "\n")
            quote = (f.get("best_quote") or "").strip()
            attrib = f.get("best_quote_attribution") or {}
            if quote:
                cite = ""
                if attrib.get("author") or attrib.get("source"):
                    cite = f" — _{attrib.get('author', 'anon')} · {attrib.get('source', 'unknown')}_"
                out.append(f"> \"{quote}\"{cite}\n")
            srcs = f.get("source_breakdown") or {}
            if srcs:
                parts = [f"**{n}** {s}" for s, n in sorted(srcs.items(), key=lambda x: -x[1]) if n > 0]
                out.append("Sources: " + " · ".join(parts) + "\n")

    # § Competitor landscape
    competitors = report.get("competitors") or []
    if competitors:
        out.append("## Competitor landscape")
        for c in competitors:
            name = c.get("name") or "(unnamed)"
            pricing = c.get("pricing_signal")
            out.append(f"### {name}" + (f" _({pricing})_" if pricing else ""))
            features = c.get("features") or []
            weaknesses = c.get("weaknesses") or []
            if features:
                out.append("**Features**")
                for x in features:
                    out.append(f"- {x}")
            if weaknesses:
                out.append("\n**Weaknesses**")
                for x in weaknesses:
                    out.append(f"- {x}")
            out.append("")

    # § Quadrant summary
    quad = report.get("quadrant") or {}
    if any(quad.get(b) for b in ("greenfield", "crowded", "niche", "mature")):
        out.append("## Opportunity quadrant")
        for bucket, label in (
            ("greenfield", "🟢 Greenfield (high pain, low competition)"),
            ("crowded",    "🔴 Crowded (high pain, high competition)"),
            ("niche",      "🔵 Niche (low pain, low competition)"),
            ("mature",     "⚪ Mature (low pain, high competition)"),
        ):
            items = quad.get(bucket) or []
            if items:
                out.append(f"**{label}:** {', '.join(items)}")
        out.append("")

    # § Hypothesis cards — top 5 with falsifiers
    if include_hypotheses:
        hyps = report.get("hypotheses") or []
        if hyps:
            out.append("## Hypothesis cards (Popper-validated)")
            for i, h in enumerate(hyps[:5], 1):
                out.append(f"### H{i}: {h.get('finding_title') or h.get('experiences') or '(untitled)'}")
                out.append(f"- **We believe:** {h.get('we_believe', '')}")
                out.append(f"- **Experiences:** {h.get('experiences', '')}")
                if h.get("because"):
                    out.append(f"- **Because:** {h['because']}")
                out.append(f"- **And would:** {h.get('and_would', '')}")
                out.append(f"- **For:** {h.get('for', '')}")
                fals = h.get("falsifiers") or []
                if fals:
                    out.append("- **We'll know we're wrong if:**")
                    for x in fals:
                        out.append(f"  - {x}")
                if h.get("cheapest_test"):
                    t = h.get("time_box_days", 14)
                    b = h.get("budget_usd", 100)
                    out.append(f"- **Cheapest test:** {h['cheapest_test']} · {t}d · ${b}")
                out.append("")

    # § Corpus stats (footer)
    cov = report.get("corpus_coverage") or {}
    if cov:
        sources_str = ", ".join(cov.get("sources_represented") or [])
        out.append(f"---\n_Generated from {cov.get('total_posts_considered', '—')} posts across {sources_str}. "
                   f"Provider: {report.get('provider', 'unknown')}._")

    return "\n".join(out)


def export_hypothesis_cards(topic: str | None = None) -> str:
    """Export tracked hypothesis-tests (Phase 3 bets) as markdown.

    Each bet renders as its own section with state, journal, and
    falsifiers. Filter by topic or export all.
    """
    from .hypothesis_tracker import list_hypotheses
    rows = list_hypotheses(topic=topic, include_archived=False)
    if not rows:
        return "# Hypothesis cards\n\n(No tracked bets yet.)"

    out = []
    out.append(f"# Hypothesis cards — " + (topic or "all topics"))
    out.append(f"_Exported {datetime.now(timezone.utc).strftime('%Y-%m-%d')}_\n")

    state_emoji = {
        "draft": "📝", "running": "🏃", "validated": "✓",
        "invalidated": "✗", "paused": "⏸", "archived": "📦",
    }
    for r in rows:
        card = r.get("card") or {}
        emoji = state_emoji.get(r["status"], "•")
        out.append(f"## {emoji} {card.get('finding_title') or card.get('experiences') or '(untitled)'}")
        out.append(f"_Topic: {r['topic']} · Status: **{r['status']}**_\n")
        if card.get("we_believe"):     out.append(f"- **We believe:** {card['we_believe']}")
        if card.get("experiences"):    out.append(f"- **Experiences:** {card['experiences']}")
        if card.get("because"):        out.append(f"- **Because:** {card['because']}")
        if card.get("and_would"):      out.append(f"- **And would:** {card['and_would']}")
        if card.get("for"):            out.append(f"- **For:** {card['for']}")
        fals = card.get("falsifiers") or []
        if fals:
            out.append("- **Wrong if:**")
            for f in fals:
                out.append(f"  - {f}")
        if card.get("cheapest_test"):
            t = card.get("time_box_days", 14)
            b = card.get("budget_usd", 100)
            out.append(f"- **Cheapest test:** {card['cheapest_test']} · {t}d · ${b}")
        if r.get("resolution_notes"):
            out.append("\n**Journal:**")
            out.append("```")
            out.append(r["resolution_notes"])
            out.append("```")
        out.append("")
    return "\n".join(out)


def export_slack_summary(topic: str) -> str:
    """Ultra-compact summary for Slack / DMs / tweet-length shares.

    5 lines max. Just the governing thought + top 3 findings.
    """
    report = _load_report(topic)
    if not report:
        return f"Gap Map brief for *{topic}* — no insights yet."
    lines = [f"*Gap Map: {topic}*"]
    gt = (report.get("governing_thought") or "").strip()
    if gt:
        lines.append(gt)
    findings = sorted(
        report.get("findings") or [],
        key=lambda f: f.get("opportunity_score", 0),
        reverse=True,
    )[:3]
    if findings:
        for i, f in enumerate(findings, 1):
            t = f.get("title", "")
            s = f.get("opportunity_score", 0)
            lines.append(f"{i}. {t} (opp {s:.1f}/20)")
    return "\n".join(lines)


__all__ = ["export_markdown", "export_hypothesis_cards", "export_slack_summary"]
