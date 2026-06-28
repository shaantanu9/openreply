"""GRAPH_REPORT.md — human-readable graph audit per topic.

Direct port of graphify/report.py:1-80 adapted to our domain. The HTML
viewer in export.py is great for browsing; this is the artifact you read
ONCE to decide "is this corpus saturated yet?", "what are the highest-
value product opportunities?", "what cross-domain connections did I
miss?".

Sections (in order, optimized for top-down reading):
  1. Corpus check — node/edge counts, evidence health, last collect ts
  2. Confidence breakdown — graphify-style EXTRACTED / INFERRED / AMBIGUOUS
  3. God nodes — top semantic-kind nodes by degree
  4. Communities — kind composition + label preview per community
  5. Surprising connections — cross-community high-weight edges
  6. Knowledge gaps — painpoints with zero solver candidate
  7. Cross-source bridges — findings triangulated across ≥3 source kinds
  8. Cost summary — token spend per provider/op (if ledger exists)

All sections are best-effort: missing communities (didn't run
`graph communities`) → that section says "Run `graph communities` first";
missing ChromaDB → relations section says skipped; etc. The report
NEVER fails because of a missing optional dep.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..core.db import get_db
from .build import graph_stats
from .cost import cost_summary
from .insights import (
    cross_source_bridges,
    god_nodes,
    knowledge_gaps,
    surprising_connections,
)
from .schema import ensure_graph_schema


def _edge_md(row_md: str | None) -> dict[str, Any]:
    if not row_md:
        return {}
    try:
        return json.loads(row_md) or {}
    except Exception:
        return {}


def _confidence_breakdown(topic: str) -> dict[str, int]:
    """Tally edge counts by confidence tag stored in metadata_json."""
    db = get_db()
    rows = db.query(
        "SELECT metadata_json FROM graph_edges WHERE topic = ?", [topic]
    )
    out = {"EXTRACTED": 0, "INFERRED": 0, "AMBIGUOUS": 0, "UNTAGGED": 0}
    for r in rows:
        md = _edge_md(r.get("metadata_json"))
        tag = md.get("confidence") or "UNTAGGED"
        out[tag] = out.get(tag, 0) + 1
    return out


def _communities_for_topic(topic: str) -> dict[int, dict[str, Any]]:
    """Group nodes by community_id (stored in metadata_json). Returns:
      {cid: {size, kind_counts, sample_labels}}
    Empty dict if community_id was never persisted (run `graph communities`)."""
    db = get_db()
    rows = db.query(
        "SELECT id, kind, label, metadata_json FROM graph_nodes WHERE topic = ?",
        [topic],
    )
    out: dict[int, dict[str, Any]] = {}
    for r in rows:
        md = _edge_md(r.get("metadata_json"))
        cid = md.get("community_id")
        if not isinstance(cid, (int, float)):
            continue
        cid = int(cid)
        slot = out.setdefault(cid, {
            "size": 0, "kind_counts": {}, "sample_labels": [],
        })
        slot["size"] += 1
        kind = r.get("kind") or "unknown"
        slot["kind_counts"][kind] = slot["kind_counts"].get(kind, 0) + 1
        if kind in ("painpoint", "feature_wish", "workaround", "product") \
                and len(slot["sample_labels"]) < 5:
            slot["sample_labels"].append((kind, r.get("label") or ""))
    return out


def _md_table(rows: list[list[str]], headers: list[str]) -> str:
    out = ["| " + " | ".join(headers) + " |",
           "|" + "|".join(["---"] * len(headers)) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(c).replace("|", "\\|") for c in r) + " |")
    return "\n".join(out)


def _esc(s: Any) -> str:
    """Markdown-safe label snippet — escapes pipes and trims."""
    s = str(s or "").replace("\n", " ").strip()
    s = s.replace("|", "\\|")
    return s[:120]


def render_report(topic: str) -> str:
    """Build the markdown body. Caller writes to disk separately so this
    is unit-testable without filesystem side effects."""
    ensure_graph_schema()
    stats = graph_stats(topic)
    confidence = _confidence_breakdown(topic)
    communities = _communities_for_topic(topic)
    surprises = surprising_connections(topic, limit=20)
    gaps = knowledge_gaps(topic, limit=20)
    bridges = cross_source_bridges(topic, limit=20)
    gods = god_nodes(topic, limit=15)
    cost = cost_summary(topic)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    parts: list[str] = []
    parts.append(f"# Graph Report — {topic}")
    parts.append("")
    parts.append(f"_Generated {now} UTC. This is the human-readable audit of "
                 f"the topic's knowledge graph — corpus health, communities, "
                 f"surprising connections, gaps, and triangulated findings._")
    parts.append("")

    # ── 1. Corpus check
    parts.append("## 1. Corpus check")
    parts.append("")
    parts.append(f"- **Total nodes:** {stats['total_nodes']:,}")
    parts.append(f"- **Total edges:** {stats['total_edges']:,}")
    parts.append("")
    parts.append("**Nodes by kind**")
    parts.append("")
    parts.append(_md_table(
        [[k, str(v)] for k, v in sorted(
            stats["nodes_by_kind"].items(), key=lambda kv: -kv[1])],
        ["Kind", "Count"],
    ))
    parts.append("")
    parts.append("**Edges by kind**")
    parts.append("")
    parts.append(_md_table(
        [[k, str(v)] for k, v in sorted(
            stats["edges_by_kind"].items(), key=lambda kv: -kv[1])],
        ["Kind", "Count"],
    ))
    parts.append("")

    # ── 2. Confidence breakdown
    parts.append("## 2. Edge confidence (graphify-style provenance)")
    parts.append("")
    parts.append("Each edge is tagged with how it was derived:")
    parts.append("")
    parts.append("- **EXTRACTED** — deterministic SQL join (structural). "
                 "Always trustworthy.")
    parts.append("- **INFERRED** — produced by the LLM enrichment pass OR a "
                 "strong structural signal (shared evidence). Trustworthy in "
                 "context.")
    parts.append("- **AMBIGUOUS** — cosine-only similarity with no other "
                 "corroborating signal. Use as a hint, not a fact.")
    parts.append("")
    parts.append(_md_table(
        [[k, str(v)] for k, v in confidence.items() if v],
        ["Confidence", "Count"],
    ))
    parts.append("")

    # ── 3. God nodes
    parts.append("## 3. God nodes (most-connected findings)")
    parts.append("")
    if not gods:
        parts.append("_No semantic nodes yet — run `graph enrich` first._")
    else:
        parts.append(_md_table(
            [[g["kind"], _esc(g["label"]), str(g["degree"]),
              str(g.get("evidence_count") or 0), str(g.get("source_diversity") or 0)]
             for g in gods],
            ["Kind", "Label", "Degree", "Evidence", "Sources"],
        ))
    parts.append("")

    # ── 4. Communities
    parts.append("## 4. Communities")
    parts.append("")
    if not communities:
        parts.append("_No community assignments persisted yet. Run "
                     "`graph communities <topic>` first to populate "
                     "`community_id` on each node._")
    else:
        # Top communities by size
        top = sorted(communities.items(), key=lambda kv: -kv[1]["size"])[:15]
        rows = []
        for cid, info in top:
            kinds = ", ".join(f"{k}:{n}" for k, n in sorted(
                info["kind_counts"].items(), key=lambda kv: -kv[1])[:6])
            sample = "; ".join(f"{k}: {_esc(l)}" for k, l in info["sample_labels"][:3])
            rows.append([str(cid), str(info["size"]), kinds, sample])
        parts.append(_md_table(rows, ["ID", "Size", "Kinds", "Sample findings"]))
        parts.append("")
        parts.append(f"_{len(communities)} communities total. "
                     f"Showing the {len(top)} largest._")
    parts.append("")

    # ── 5. Surprising connections
    parts.append("## 5. Surprising connections")
    parts.append("")
    parts.append("_Edges whose endpoints live in different communities — the "
                 "unexpected links worth investigating._")
    parts.append("")
    if not surprises:
        if not communities:
            parts.append("_(Run `graph communities <topic>` to populate this section.)_")
        else:
            parts.append("_No cross-community edges found yet — graph may be too sparse._")
    else:
        rows = []
        for s in surprises[:20]:
            rows.append([
                _esc(s["src_label"]),
                _esc(s["dst_label"]),
                s["edge_kind"],
                str(round(s["weight"], 3)),
                str(s.get("shared_evidence") or 0),
                s.get("confidence") or "—",
            ])
        parts.append(_md_table(rows, [
            "Src", "Dst", "Edge", "Weight", "Shared evidence", "Confidence"
        ]))
    parts.append("")

    # ── 6. Knowledge gaps
    parts.append("## 6. Knowledge gaps (painpoints with no candidate solver)")
    parts.append("")
    parts.append("_Painpoints with zero `could_address` / `potentially_solves` "
                 "neighbors — product opportunities the corpus surfaces but "
                 "no one has proposed a fix for._")
    parts.append("")
    if not gaps:
        parts.append("_No unsolved painpoints — every painpoint has at "
                     "least one candidate solver in the graph._")
    else:
        rows = []
        for g in gaps[:20]:
            rows.append([
                _esc(g["label"]),
                str(g.get("evidence_count") or 0),
                str(g.get("source_diversity") or 0),
                str(g.get("classification") or "—"),
            ])
        parts.append(_md_table(rows, [
            "Painpoint", "Evidence", "Sources", "Classification"
        ]))
    parts.append("")

    # ── 7. Cross-source bridges
    parts.append("## 7. Cross-source bridges (≥3 source kinds)")
    parts.append("")
    parts.append("_Findings whose evidence triangulates across at least three "
                 "distinct source kinds. The single strongest credibility "
                 "signal in qualitative research._")
    parts.append("")
    if not bridges:
        parts.append("_No findings hit the ≥3-source threshold yet — "
                     "collect from another source type to triangulate._")
    else:
        rows = []
        for b in bridges[:20]:
            sb = b.get("source_breakdown") or {}
            sb_str = ", ".join(f"{s}:{n}" for s, n in sorted(
                sb.items(), key=lambda kv: -kv[1]))
            rows.append([
                b["kind"], _esc(b["label"]),
                str(b.get("source_diversity") or 0),
                str(b.get("evidence_count") or 0),
                sb_str,
            ])
        parts.append(_md_table(rows, [
            "Kind", "Label", "Sources", "Evidence", "Breakdown"
        ]))
    parts.append("")

    # ── 8. Cost summary
    parts.append("## 8. Cost summary")
    parts.append("")
    if not cost.get("calls"):
        parts.append("_No LLM enrichment calls logged yet._")
    else:
        parts.append(f"- **Calls:** {cost['calls']}")
        parts.append(f"- **Total est. USD:** ${cost['total_usd']}")
        parts.append(f"- **Input tokens:** {cost['total_input_tokens']:,}")
        parts.append(f"- **Output tokens:** {cost['total_output_tokens']:,}")
        if cost.get("unknown_pricing_calls"):
            parts.append(f"- **Unknown-pricing calls:** "
                         f"{cost['unknown_pricing_calls']} "
                         f"(extend `_PRICING` in `graph/cost.py` to cover)")
        if cost.get("by_provider"):
            parts.append("")
            parts.append("**By provider**")
            parts.append("")
            parts.append(_md_table(
                [[p, str(d["calls"]), str(round(d["usd"], 4)),
                  str(d["input"]), str(d["output"])]
                 for p, d in cost["by_provider"].items()],
                ["Provider", "Calls", "USD", "Input", "Output"],
            ))
    parts.append("")
    parts.append("---")
    parts.append("")
    parts.append("_Re-run `graph report <topic>` after any enrich/relate/"
                 "communities pass to refresh this file._")
    parts.append("")
    return "\n".join(parts)


def emit_report(topic: str, out_dir: str | Path | None = None) -> Path:
    """Render and write GRAPH_REPORT_<topic>.md. Returns the file path."""
    body = render_report(topic)
    base = Path(out_dir) if out_dir else Path("graphify-out")
    base.mkdir(parents=True, exist_ok=True)
    safe_topic = "".join(
        c if (c.isalnum() or c in "-_") else "_" for c in topic.lower()
    )
    path = base / f"GRAPH_REPORT_{safe_topic}.md"
    path.write_text(body, encoding="utf-8")
    return path


__all__ = ["render_report", "emit_report"]
