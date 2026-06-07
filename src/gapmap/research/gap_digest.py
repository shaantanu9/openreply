"""Gap digest — a scheduled brief of what's moving in a topic.

IdeaBrowser's retention loop is a single researched thing delivered on a
cadence. Our version composes the signals we already compute — top pain scores,
rising gaps, the people to reach, and any fired alerts — into one markdown brief
you can read, export, or (later) email. Pure assembly, no LLM.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def build_digest(topic: str, *, period: str = "daily",
                 window_days: int | None = None) -> dict[str, Any]:
    """Assemble a digest for a topic. Returns {ok, topic, period, markdown,
    sections}. Reads cached pain scores / velocity / people / alert events."""
    from . import pain_scoring, trend_velocity, gap_audience, gap_alerts

    if window_days is None:
        window_days = 7 if period == "weekly" else 1

    scores = pain_scoring.get(topic).get("rows", [])
    top_gaps = scores[:5]

    # Rising / new gaps from velocity (best-effort).
    rising: list[dict] = []
    try:
        vel = trend_velocity.compute_gap_velocity(topic, window_days=max(window_days, 7))
        for r in (vel.get("rows") or []):
            if r.get("direction") in ("rising", "new"):
                rising.append(r)
        rising.sort(key=lambda x: (x.get("velocity_pct") or 0), reverse=True)
        rising = rising[:5]
    except Exception:
        rising = []

    people = gap_audience.get_topic_reachout(topic, limit=5).get("rows", [])
    events = gap_alerts.list_events(topic, limit=10).get("rows", [])

    # ---- markdown ----
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines = [f"# Gap Map digest — {topic}", "", f"*{period.capitalize()} brief · {now}*", ""]

    lines.append("## 🔥 Top gaps by pain")
    if top_gaps:
        for i, g in enumerate(top_gaps, 1):
            lines.append(f"{i}. **{g.get('title')}** — pain **{g.get('pain_score')}** "
                         f"(freq {g.get('frequency')}, {g.get('severity')})")
    else:
        lines.append("_No scored gaps yet — run pain scores first._")
    lines.append("")

    lines.append("## 📈 Rising / new")
    if rising:
        for r in rising:
            tag = "NEW" if r.get("direction") == "new" else f"+{r.get('velocity_pct')}%"
            lines.append(f"- **{r.get('title')}** ({tag}, {r.get('matched')} posts)")
    else:
        lines.append("_Nothing rising in this window._")
    lines.append("")

    lines.append("## 👥 People to reach")
    if people:
        for p in people:
            persona = f" · {p.get('persona_label')}" if p.get("persona_label") else ""
            lines.append(f"- u/{p.get('author')} (engagement {p.get('engagement')}{persona})")
    else:
        lines.append("_Build the people list to populate this._")
    lines.append("")

    lines.append("## 🔔 Recent alerts")
    if events:
        for e in events[:5]:
            lines.append(f"- **{e.get('kind')}** — {e.get('detail')} "
                         f"({(e.get('created_at') or '')[:10]})")
    else:
        lines.append("_No alert events._")
    lines.append("")

    markdown = "\n".join(lines)
    return {
        "ok": True, "topic": topic, "period": period, "generated_at": now,
        "markdown": markdown,
        "sections": {
            "top_gaps": top_gaps, "rising": rising,
            "people": people, "alerts": events[:5],
        },
    }


__all__ = ["build_digest"]
