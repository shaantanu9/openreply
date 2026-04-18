"""Render a gap report as Markdown — compiles the 4 extractor outputs."""
from __future__ import annotations

from typing import Any


def _fmt_list(items: list[dict] | dict | None, kind: str) -> list[str]:
    if not items:
        return [f"_No {kind} extracted._"]
    if isinstance(items, dict) and items.get("_parse_error"):
        raw = (items.get("_raw") or "")[:500]
        return [f"_LLM returned unparsable output. First 500 chars:_\n\n```\n{raw}\n```"]
    if not isinstance(items, list):
        return [f"_Unexpected shape: {type(items).__name__}_"]

    lines: list[str] = []
    for i, it in enumerate(items, 1):
        if kind == "painpoints":
            lines.append(
                f"**{i}. {it.get('painpoint','(no title)')}** "
                f"— severity: `{it.get('severity','?')}`, freq: `{it.get('frequency','?')}`"
            )
            if it.get("evidence"):
                lines.append(f"> {it['evidence']}")
        elif kind == "feature_wishes":
            lines.append(
                f"**{i}. {it.get('feature','(no title)')}** — freq: `{it.get('frequency','?')}`"
            )
            if it.get("user_quote"):
                lines.append(f"> {it['user_quote']}")
        elif kind == "product_complaints":
            lines.append(
                f"**{i}. {it.get('product','(unnamed)')}** "
                f"— severity: `{it.get('severity','?')}`, freq: `{it.get('frequency','?')}`"
            )
            if it.get("complaint"):
                lines.append(f"> {it['complaint']}")
        elif kind == "diy_workarounds":
            lines.append(
                f"**{i}. {it.get('workaround','(no desc)')}** — freq: `{it.get('frequency','?')}`"
            )
            if it.get("gap"):
                lines.append(f"Gap: _{it['gap']}_")
            if it.get("user_quote"):
                lines.append(f"> {it['user_quote']}")
        ids = it.get("example_post_ids") or []
        if ids:
            lines.append(f"<sub>posts: {', '.join(ids[:5])}</sub>")
        lines.append("")
    return lines


def render_markdown(report: dict[str, Any]) -> str:
    topic = report.get("topic", "?")
    lines = [
        f"# Gap Report — {topic}",
        "",
        f"Corpus: **{report.get('corpus_size', '?')}** posts · "
        f"Provider: `{report.get('provider','?')}`",
        "",
    ]
    if report.get("error"):
        lines.append(f"**Error:** {report['error']}")
        return "\n".join(lines)

    sections = [
        ("## 🔥 Pain points", report.get("painpoints"), "painpoints"),
        ("## 💡 Feature wishes", report.get("feature_wishes"), "feature_wishes"),
        ("## 😡 Product complaints", report.get("product_complaints"), "product_complaints"),
        ("## 🛠 DIY workarounds (strongest gap signal)", report.get("diy_workarounds"), "diy_workarounds"),
    ]
    for heading, items, kind in sections:
        lines.append(heading)
        lines.append("")
        lines.extend(_fmt_list(items, kind))
        lines.append("")
    return "\n".join(lines)
