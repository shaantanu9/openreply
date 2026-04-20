"""Dual-Mode Pivot — weekly markdown digest for a product.

Same clipboard-first pattern as export_brief.py. Output is drop-into-Slack
or drop-into-Notion / Linear markdown. Covers the five dashboard sections
in one scannable document.

Layout (per DUAL_MODE_PIVOT.md §4.4):

    ▓▓▓ Your product ▓▓▓         — The Mirror summary
    ▓▓▓ Competitor moves ▓▓▓     — The Lens per-competitor lines
    ▓▓▓ Category ▓▓▓             — The Field emerging/fading
    ▓▓▓ Top 3 signals this week ▓▓▓  — Ranked from The Signals

Non-goals: no email delivery (copy to clipboard instead), no Slack webhook
(same), no PDF. Those are Phase D/G territory.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any

from ..core.db import get_db
from . import product as product_mod
from . import product_sweep
from . import monitor as monitor_mod


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load_latest_report(topic: str) -> dict[str, Any]:
    import json
    db = get_db()
    if "topic_insights" not in db.table_names():
        return {}
    rows = list(db.query(
        "SELECT report_json FROM topic_insights WHERE topic = ?", [topic]
    ))
    if not rows:
        return {}
    try:
        return json.loads(rows[0]["report_json"] or "{}")
    except Exception:
        return {}


def build_digest(product_id: str, days: int = 7) -> str:
    """Build a weekly markdown digest string. Pure function — no side
    effects. Caller is responsible for clipboarding or sending."""
    pinfo = product_mod.get_product(product_id)
    if not pinfo.get("ok"):
        return f"# Digest error\n\n{pinfo.get('error', 'product not found')}"
    product = pinfo["product"]
    competitors = pinfo.get("competitors", [])
    topic = product.get("topic") or product_id
    report = _load_latest_report(topic)
    findings = sorted(
        report.get("findings") or [],
        key=lambda f: f.get("opportunity_score") or 0,
        reverse=True,
    )
    # Recent signals (last `days`)
    signals = product_sweep.list_signals(
        product_id, since_days=days, include_resolved=False, limit=50,
    )

    # Sort by severity*confidence
    signals_ranked = sorted(
        signals,
        key=lambda s: (s.get("severity") or 0) * (s.get("confidence") or 0),
        reverse=True,
    )

    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    lines: list[str] = []
    lines.append(f"# {product['name']} — Weekly digest ({today})")
    lines.append("")
    if product.get("one_liner"):
        lines.append(f"_{product['one_liner']}_")
        lines.append("")

    # ── YOUR PRODUCT ────────────────────────────────────────────────────
    lines.append("## Your product")
    lines.append("")
    # Pull findings most likely relevant to "your product" — we don't have
    # review ingest yet, so lean on the synthesis findings plus regression
    # signals.
    regressions = [s for s in signals_ranked if s["signal_type"] == "your_product_regression"]
    if regressions:
        for s in regressions[:3]:
            lines.append(f"- 🔻 **{s['title']}** — {s.get('description', '')}")
    else:
        lines.append("- No regression signals this week. Baseline holds.")
    lines.append("")

    # ── COMPETITOR MOVES ────────────────────────────────────────────────
    lines.append("## Competitor moves")
    lines.append("")
    comp_signals = [
        s for s in signals_ranked
        if s["signal_type"] in ("competitor_release", "competitor_vulnerability")
    ]
    if comp_signals:
        by_comp: dict[str, list] = {}
        for s in comp_signals:
            by_comp.setdefault(s.get("related_competitor") or "?", []).append(s)
        for cname, sigs in list(by_comp.items())[:8]:
            lines.append(f"**{cname}**")
            for s in sigs[:2]:
                emoji = "🚀" if s["signal_type"] == "competitor_release" else "🎯"
                lines.append(f"  - {emoji} {s['title']} — {s.get('description','')[:140]}")
        lines.append("")
    else:
        lines.append("- No tracked competitor signals this week.")
        lines.append("")

    # ── CATEGORY ────────────────────────────────────────────────────────
    lines.append("## Category")
    lines.append("")
    emerging = [s for s in signals_ranked if s["signal_type"] == "chronic_emergence"]
    intensifying = [s for s in signals_ranked if s["signal_type"] == "unmet_need_intensifying"]
    if emerging or intensifying:
        for s in emerging[:3]:
            lines.append(f"- ⚠ **Emerging**: {s['title']}")
        for s in intensifying[:3]:
            lines.append(f"- 📈 **Rising**: {s['title']}")
    else:
        # Fall back to top 3 findings in the latest report
        if findings:
            lines.append("- Top opportunities in latest synthesis:")
            for f in findings[:3]:
                score = f.get("opportunity_score") or 0
                lines.append(f"  - `{score:.1f}/20` — {f.get('title', '(untitled)')}")
        else:
            lines.append("- No category signals yet. Run a sweep to populate.")
    lines.append("")

    # ── TOP 3 SIGNALS THIS WEEK ─────────────────────────────────────────
    lines.append("## Top 3 signals — act on these")
    lines.append("")
    if signals_ranked:
        for i, s in enumerate(signals_ranked[:3], 1):
            emoji = {
                "competitor_release": "🚀",
                "chronic_emergence": "⚠",
                "your_product_regression": "🔻",
                "unmet_need_intensifying": "📈",
                "competitor_vulnerability": "🎯",
                "mention_spike": "🔊",
            }.get(s["signal_type"], "•")
            sev = s.get("severity") or 0
            conf = s.get("confidence") or 0
            lines.append(f"{i}. {emoji} **{s['title']}**  "
                         f"(sev {sev:.2f} · conf {conf:.2f})")
            if s.get("description"):
                lines.append(f"   {s['description']}")
            if s.get("suggested_action"):
                lines.append(f"   **→** {s['suggested_action']}")
            lines.append("")
    else:
        lines.append("- No open signals. Good week.")
        lines.append("")

    # Footer
    lines.append("---")
    lines.append(f"_Generated by Gap Map · {product['name']} "
                 f"({len(competitors)} competitors tracked · "
                 f"last sweep {product.get('last_swept_at','never')})_")
    lines.append("")
    lines.append("_Copy this to Slack, paste into Notion / Linear, or forward as-is._")
    return "\n".join(lines)


def build_mirror_section(product_id: str, days: int = 7) -> dict[str, Any]:
    """The Mirror — what's being said about YOUR product.

    Returns structured data for the UI to render, not markdown.
    """
    pinfo = product_mod.get_product(product_id)
    if not pinfo.get("ok"):
        return {"ok": False, "error": pinfo.get("error")}
    product = pinfo["product"]
    signals = product_sweep.list_signals(
        product_id, since_days=days, include_resolved=False, limit=50,
    )
    regressions = [s for s in signals if s["signal_type"] == "your_product_regression"]
    spikes = [s for s in signals if s["signal_type"] == "mention_spike"]
    return {
        "ok": True,
        "product_id": product_id,
        "product_name": product["name"],
        "regressions": regressions,
        "mention_spikes": spikes,
        "window_days": days,
    }


def build_lens_section(product_id: str, days: int = 7) -> dict[str, Any]:
    """The Lens — per-competitor view."""
    pinfo = product_mod.get_product(product_id)
    if not pinfo.get("ok"):
        return {"ok": False, "error": pinfo.get("error")}
    competitors = pinfo.get("competitors", [])
    signals = product_sweep.list_signals(
        product_id, since_days=days, include_resolved=False, limit=100,
    )
    per_competitor: dict[str, dict] = {}
    for c in competitors:
        cname = c["competitor_name"]
        per_competitor[cname] = {
            "name": cname,
            "urls": c.get("urls", {}),
            "releases": [],
            "vulnerabilities": [],
            "mention_spikes": [],
        }
    for s in signals:
        rc = s.get("related_competitor") or ""
        if not rc or rc not in per_competitor:
            continue
        bucket = {
            "competitor_release": "releases",
            "competitor_vulnerability": "vulnerabilities",
            "mention_spike": "mention_spikes",
        }.get(s["signal_type"])
        if bucket:
            per_competitor[rc][bucket].append(s)
    return {
        "ok": True,
        "product_id": product_id,
        "competitors": list(per_competitor.values()),
        "window_days": days,
    }


def build_field_section(product_id: str, days: int = 7) -> dict[str, Any]:
    """The Field — category-wide emerging/fading."""
    pinfo = product_mod.get_product(product_id)
    if not pinfo.get("ok"):
        return {"ok": False, "error": pinfo.get("error")}
    product = pinfo["product"]
    topic = product.get("topic") or product_id
    report = _load_latest_report(topic)
    findings = sorted(
        report.get("findings") or [],
        key=lambda f: f.get("opportunity_score") or 0,
        reverse=True,
    )
    signals = product_sweep.list_signals(
        product_id, since_days=days, include_resolved=False, limit=50,
    )
    emerging = [s for s in signals if s["signal_type"] == "chronic_emergence"]
    rising = [s for s in signals if s["signal_type"] == "unmet_need_intensifying"]
    return {
        "ok": True,
        "product_id": product_id,
        "category": product.get("category") or "",
        "top_findings": findings[:5],
        "emerging": emerging,
        "rising": rising,
        "window_days": days,
    }


__all__ = [
    "build_digest",
    "build_mirror_section",
    "build_lens_section",
    "build_field_section",
]
