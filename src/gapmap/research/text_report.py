"""Plain-text/markdown findings report — what you'd actually paste into a tweet.

Renders top painpoints, DIY workarounds, product complaints, feature wishes
from the graph as a concise markdown block. Includes evidence counts and
temporal classification badges.
"""
from __future__ import annotations

from typing import Any

from ..core.db import get_db


def _pull_findings(topic: str, kind: str, top_n: int = 10) -> list[dict]:
    db = get_db()
    # Count only direct evidence edges (not about_product etc) so rank reflects
    # how many real posts support each finding, not edge topology.
    evidence_kinds = {
        "painpoint": ("evidenced_by",),
        "feature_wish": ("wished_in",),
        "product": ("about_product",),
        "workaround": ("built_in", "solves"),
    }.get(kind, ("evidenced_by",))
    placeholders = ",".join("?" for _ in evidence_kinds)
    rows = list(
        db.query(
            f"""
            SELECT n.id, n.label, n.metadata_json,
                   (SELECT count(*) FROM graph_edges e
                    WHERE e.topic = n.topic AND (e.src = n.id OR e.dst = n.id)
                      AND e.kind IN ({placeholders}))
                    AS evidence_count
            FROM graph_nodes n
            WHERE n.topic = ? AND n.kind = ?
            ORDER BY evidence_count DESC, COALESCE(json_extract(n.metadata_json,'$.frequency'),0) DESC
            LIMIT ?
            """,
            [*evidence_kinds, topic, kind, top_n],
        )
    )
    import json
    out = []
    for r in rows:
        md: dict[str, Any] = {}
        try:
            md = json.loads(r.get("metadata_json") or "{}")
        except json.JSONDecodeError:
            pass
        out.append({
            "id": r["id"], "label": r["label"],
            "metadata": md, "evidence_count": r.get("evidence_count", 0),
        })
    return out


def _source_breakdown(topic: str) -> list[dict]:
    # Alias must be distinct from topic_posts.source column name or SQLite
    # binds GROUP BY to the column, producing per-collect-run duplicates.
    db = get_db()
    return list(
        db.query(
            """
            SELECT coalesce(p.source_type, 'reddit') AS src, count(*) AS n
            FROM posts p JOIN topic_posts tp ON tp.post_id = p.id
            WHERE tp.topic = ? GROUP BY src ORDER BY n DESC
            """,
            [topic],
        )
    )


def render_text_report(topic: str, top_n: int = 5) -> str:
    pps = _pull_findings(topic, "painpoint", top_n=top_n)
    wos = _pull_findings(topic, "workaround", top_n=top_n)
    prs = _pull_findings(topic, "product", top_n=top_n)
    fws = _pull_findings(topic, "feature_wish", top_n=top_n)
    sources = _source_breakdown(topic)
    total_posts = sum(s["n"] for s in sources)

    lines: list[str] = [
        f"# Gap Map — {topic}",
        "",
        f"**{total_posts:,} posts** across {len(sources)} source types · "
        f"{len(pps)} painpoints · {len(wos)} DIY workarounds · {len(prs)} products named · "
        f"{len(fws)} feature wishes",
        "",
    ]

    if sources:
        lines.append("**Sources:** " + " · ".join(f"{s['src']} {s['n']:,}" for s in sources))
        lines.append("")

    def _section(title: str, items: list[dict], render_fn) -> None:
        if not items:
            return
        lines.append(title)
        lines.append("")
        for i, it in enumerate(items, 1):
            lines.extend(render_fn(i, it))
        lines.append("")

    def _pp(i, it):
        md = it["metadata"] or {}
        badge = f" · **{md['classification']}**" if md.get("classification") and md["classification"] != "UNCLASSIFIED" else ""
        sev = f" · severity: `{md['severity']}`" if md.get("severity") else ""
        freq = f" · freq: {md['frequency']}" if md.get("frequency") else ""
        ev = f" · 📎 {it['evidence_count']} evidence" if it["evidence_count"] else ""
        r = [f"**{i}. {it['label']}**{badge}{sev}{freq}{ev}"]
        if md.get("evidence"):
            r.append(f"   > {md['evidence']}")
        return r

    def _wo(i, it):
        md = it["metadata"] or {}
        gap = f" _gap: {md['gap']}_" if md.get("gap") else ""
        ev = f" · 📎 {it['evidence_count']}" if it["evidence_count"] else ""
        r = [f"**{i}. {it['label']}**{gap}{ev}"]
        if md.get("user_quote"):
            r.append(f"   > {md['user_quote']}")
        return r

    def _pr(i, it):
        md = it["metadata"] or {}
        sev = f" · severity: `{md['severity']}`" if md.get("severity") else ""
        freq = f" · freq: {md['frequency']}" if md.get("frequency") else ""
        return [f"**{i}. {it['label']}**{sev}{freq}"]

    def _fw(i, it):
        md = it["metadata"] or {}
        freq = f" · freq: {md['frequency']}" if md.get("frequency") else ""
        r = [f"**{i}. {it['label']}**{freq}"]
        if md.get("user_quote"):
            r.append(f"   > {md['user_quote']}")
        return r

    _section(f"## 🔥 Top painpoints", pps, _pp)
    _section(f"## 🛠 DIY workarounds (strongest gap signal)", wos, _wo)
    _section(f"## 😡 Products complained about", prs, _pr)
    _section(f"## 💡 Feature wishes", fws, _fw)

    return "\n".join(lines)


def render_tweet(topic: str) -> str:
    """Render a terse 3-finding tweet-sized summary."""
    pps = _pull_findings(topic, "painpoint", top_n=3)
    wos = _pull_findings(topic, "workaround", top_n=2)
    if not pps:
        return f"Gap map for {topic}: nothing extracted yet — run enrichment first."

    lines = [f"Gap map — {topic}:", ""]
    for i, pp in enumerate(pps, 1):
        md = pp["metadata"] or {}
        badge = f" [{md['classification']}]" if md.get("classification") and md["classification"] != "UNCLASSIFIED" else ""
        lines.append(f"{i}. {pp['label']}{badge}")
    if wos:
        lines.append("")
        lines.append(f"Users are hacking around this with:")
        for w in wos[:2]:
            lines.append(f"• {w['label']}")
    return "\n".join(lines)
