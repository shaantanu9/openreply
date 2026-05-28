"""Graph exporters — JSON + self-contained HTML "Gap Map" viewer.

The HTML is findings-first: conclusions surface as the primary column on
the left (painpoints / products / DIY / features — ranked and classified),
the graph is supporting viz, and a right-hand panel shows evidence posts
for whatever is selected. Double-click the file, it opens in any browser.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..core.db import get_db
from .query import _parse_metadata


def _classification_summary(findings: list[dict]) -> dict[str, int]:
    out = {"CHRONIC": 0, "EMERGING": 0, "FADING": 0, "UNCLASSIFIED": 0}
    for f in findings:
        c = (f.get("metadata") or {}).get("classification") or "UNCLASSIFIED"
        out[c] = out.get(c, 0) + 1
    return out


def _source_breakdown_for_node(topic: str, node_id: str) -> dict[str, int]:
    """Group the evidence posts linked to a node by source_type."""
    db = get_db()
    post_prefix = f"{topic}::post::"
    rows = list(
        db.query(
            """
            WITH ev AS (
                SELECT CASE WHEN e.src = ? THEN e.dst ELSE e.src END AS nid
                FROM graph_edges e
                WHERE e.topic = ? AND (e.src = ? OR e.dst = ?)
                  AND e.kind IN ('evidenced_by','wished_in','built_in','solves','about_product','supports')
            )
            SELECT coalesce(p.source_type, 'reddit') AS src, count(*) AS n
            FROM posts p JOIN ev ON ev.nid = ? || p.id
            GROUP BY src ORDER BY n DESC
            """,
            [node_id, topic, node_id, node_id, post_prefix],
        )
    )
    return {r["src"]: r["n"] for r in rows}


def _saturation_for_node(topic: str, node_id: str) -> dict[str, Any]:
    """Compute Guest/Bunce/Johnson (2006) saturation signal per finding.

    Saturation = a claim has enough independent evidence that further
    sampling would not change the conclusion. We operationalize as:
      - unique_authors   : distinct usernames across evidence posts
      - source_diversity : count of distinct source_types
      - n_evidence       : total evidence-edge count
      - saturated        : true iff n_evidence ≥ 12 AND source_diversity ≥ 2
      - confidence       : label ('saturated' | 'adequate' | 'tentative' | 'thin')

    Thresholds follow the 12-interview saturation rule of thumb.
    """
    db = get_db()
    post_prefix = f"{topic}::post::"
    rows = list(
        db.query(
            """
            WITH ev AS (
                SELECT CASE WHEN e.src = ? THEN e.dst ELSE e.src END AS nid
                FROM graph_edges e
                WHERE e.topic = ? AND (e.src = ? OR e.dst = ?)
                  AND e.kind IN ('evidenced_by','wished_in','built_in','solves','about_product','supports')
            )
            SELECT
              count(*) AS n_evidence,
              count(DISTINCT CASE WHEN p.author NOT IN ('[deleted]','[anon]','[local]','') THEN p.author END) AS unique_authors,
              count(DISTINCT coalesce(p.source_type,'reddit')) AS source_diversity
            FROM posts p JOIN ev ON ev.nid = ? || p.id
            """,
            [node_id, topic, node_id, node_id, post_prefix],
        )
    )
    r = rows[0] if rows else {}
    n_ev = int(r.get("n_evidence") or 0)
    unique = int(r.get("unique_authors") or 0)
    diversity = int(r.get("source_diversity") or 0)

    # Confidence bucket per research norms
    if n_ev >= 12 and diversity >= 2:
        confidence = "saturated"
    elif n_ev >= 8 and diversity >= 2:
        confidence = "adequate"
    elif n_ev >= 4:
        confidence = "tentative"
    else:
        confidence = "thin"

    return {
        "n_evidence": n_ev,
        "unique_authors": unique,
        "source_diversity": diversity,
        "confidence": confidence,
        "saturated": confidence == "saturated",
    }


def _findings_for_topic(topic: str) -> dict[str, list[dict]]:
    """Pull ranked findings per kind with cross-source weighted ranking.

    Ranking policy:
      1) Source diversity first (same finding seen across more source types)
      2) Evidence count second
      3) Stable label sort as tie-breaker
    """
    db = get_db()
    out: dict[str, list[dict]] = {}
    for kind in ("painpoint", "feature_wish", "product", "workaround"):
        rows = list(
            db.query(
                """
                SELECT n.id, n.label, n.metadata_json,
                       (SELECT count(*) FROM graph_edges e
                        WHERE e.topic = n.topic
                          AND (e.src = n.id OR e.dst = n.id)
                          AND e.kind IN ('evidenced_by','wished_in','about_product','built_in','solves','supports'))
                        AS evidence_count,
                       (SELECT count(DISTINCT coalesce(p.source_type,'reddit'))
                          FROM graph_edges e2
                          JOIN posts p
                            ON (e2.src = ? || p.id OR e2.dst = ? || p.id)
                         WHERE e2.topic = n.topic
                           AND (e2.src = n.id OR e2.dst = n.id)
                           AND e2.kind IN ('evidenced_by','wished_in','about_product','built_in','solves','supports'))
                        AS source_diversity
                FROM graph_nodes n
                WHERE n.topic = ? AND n.kind = ?
                ORDER BY source_diversity DESC, evidence_count DESC, n.label ASC
                """,
                [f"{topic}::post::", f"{topic}::post::", topic, kind],
            )
        )
        parsed = [_parse_metadata(r) for r in rows]
        for p, r in zip(parsed, rows, strict=False):
            p["evidence_count"] = r.get("evidence_count", 0)
            p["source_diversity"] = r.get("source_diversity", 0)
            p["source_breakdown"] = _source_breakdown_for_node(topic, p["id"])
            p["saturation"] = _saturation_for_node(topic, p["id"])
        out[kind] = parsed
    return out


SKELETON_KINDS = {
    "topic", "era", "subreddit", "source",
    "document",
    "painpoint", "feature_wish", "product", "workaround",
}


def export_graph_json(topic: str, mode: str = "skeleton", max_post_nodes: int = 120) -> dict[str, Any]:
    """D3 force-graph shape: {nodes, links, meta, findings}.

    Modes:
      'skeleton' (default) — topic/era/sub/source/painpoint/product/workaround/feature_wish
                              ONLY. Plus up to `max_post_nodes` of the highest-
                              degree posts that are linked to semantic nodes.
                              ~100-300 nodes total; renders instantly.
      'full'               — everything, including users. For small topics only.
    """
    db = get_db()
    all_nodes = {r["id"]: _parse_metadata(r) for r in db.query("SELECT * FROM graph_nodes WHERE topic = ?", [topic])}
    all_edges = list(db.query("SELECT * FROM graph_edges WHERE topic = ?", [topic]))

    keep_ids: set[str]
    if mode == "full":
        keep_ids = set(all_nodes.keys())
    else:
        keep_ids = {nid for nid, n in all_nodes.items() if n["kind"] in SKELETON_KINDS}

        # Add the top-N highest-degree post nodes that are connected to a
        # semantic node via evidence edges — so findings show their citations.
        evidence_kinds = {"evidenced_by", "wished_in", "about_product", "built_in", "solves"}
        post_scores: dict[str, int] = {}
        for e in all_edges:
            if e["kind"] not in evidence_kinds:
                continue
            for endpoint in (e["src"], e["dst"]):
                node = all_nodes.get(endpoint)
                if node and node["kind"] == "post":
                    post_scores[endpoint] = post_scores.get(endpoint, 0) + 1
        top_posts = sorted(post_scores.items(), key=lambda p: -p[1])[:max_post_nodes]
        keep_ids.update(pid for pid, _ in top_posts)

        # Fallback — if enrichment hasn't run yet, there are no evidence edges
        # and the graph would collapse to just topic↔sub/era. In that state,
        # include the top posts by engagement so the user sees a meaningful
        # sub↔post structure instead of a bare hub-and-spoke. Ranked by
        # (score + num_comments) from the `posts` table (joined by post_id).
        if not post_scores:
            post_prefix = f"{topic}::post::"
            top_rows = list(db.query(
                """
                SELECT tp.post_id AS pid,
                       coalesce(p.score,0) + coalesce(p.num_comments,0)*2 AS engagement
                FROM topic_posts tp
                LEFT JOIN posts p ON p.id = tp.post_id
                WHERE tp.topic = ?
                ORDER BY engagement DESC
                LIMIT ?
                """,
                [topic, max_post_nodes],
            ))
            for r in top_rows:
                nid = post_prefix + str(r["pid"])
                if nid in all_nodes:
                    keep_ids.add(nid)

    nodes_out = []
    for nid in keep_ids:
        if nid not in all_nodes:
            continue
        p = all_nodes[nid]
        nodes_out.append({
            "id": p["id"], "kind": p["kind"], "label": p["label"],
            "metadata": p.get("metadata", {}),
        })

    # Surface link metadata to the viewer so it can style edges by
    # graphify-style confidence (EXTRACTED / INFERRED / AMBIGUOUS), draw
    # heavier strokes for shared-evidence edges, and highlight cross-
    # community "surprising connections" without a second fetch.
    def _link_md(row: dict) -> dict:
        raw = row.get("metadata_json")
        if not raw:
            return {}
        try:
            return json.loads(raw) or {}
        except Exception:
            return {}

    links_out = [
        {
            "source": r["src"],
            "target": r["dst"],
            "kind": r["kind"],
            "weight": r.get("weight") or 1.0,
            "metadata": _link_md(r),
        }
        for r in all_edges
        if r["src"] in keep_ids and r["dst"] in keep_ids
    ]

    kinds_count: dict[str, int] = {}
    confidence_count: dict[str, int] = {}
    community_count: dict[str, int] = {}
    for n in nodes_out:
        kinds_count[n["kind"]] = kinds_count.get(n["kind"], 0) + 1
        cid = (n.get("metadata") or {}).get("community_id")
        if cid is not None:
            community_count[str(cid)] = community_count.get(str(cid), 0) + 1
    for l in links_out:
        c = (l.get("metadata") or {}).get("confidence")
        if c:
            confidence_count[c] = confidence_count.get(c, 0) + 1

    findings = _findings_for_topic(topic)

    # Real full-graph totals for the header (not just what we rendered)
    full_total_nodes = len(all_nodes)
    full_total_edges = len(all_edges)

    return {
        "meta": {
            "topic": topic,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "render_mode": mode,
            "rendered_nodes": len(nodes_out),
            "rendered_edges": len(links_out),
            "total_nodes": full_total_nodes,
            "total_edges": full_total_edges,
            "nodes_by_kind": kinds_count,
            "classification_summary": _classification_summary(findings["painpoint"]),
            # graphify-style additive metadata for the D3 viewer to color +
            # legend by. Empty dicts are fine; the JS handles missing keys.
            "edge_confidence": confidence_count,
            "community_sizes": community_count,
        },
        "findings": findings,
        "nodes": nodes_out,
        "links": links_out,
    }


_HTML_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Gap Map — {TOPIC}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    /* Matches app CSS tokens (app-tauri/src/style.css). Single source of
       truth for the exported viewer's palette. */
    --v-bg:         #F6F3EE;
    --v-surface:    #FFFFFF;
    --v-surface-2:  #FBF8F2;
    --v-ink:        #1A1614;
    --v-ink-2:      #4A4339;
    --v-ink-3:      #8A8278;
    --v-line:       #ECE6DC;
    --v-line-2:     #E2DBCF;

    --v-orange:        #FF8C42;
    --v-orange-soft:   #FFE9D6;
    --v-lavender:      #C9B6F2;
    --v-lavender-soft: #EFE7FB;
    --v-mint:          #A8DCC4;
    --v-mint-soft:     #E1F2EA;
    --v-sky:           #B5D4F0;
    --v-sky-soft:      #E4F0FA;
    --v-rose:          #F4B6BD;
    --v-rose-soft:     #FBE3E6;
    --v-gold:          #F0D78A;
    --v-gold-soft:     #FBF1D4;

    --v-chronic:   #E26A6A;
    --v-emerging:  #E69447;
    --v-fading:    #9C948A;

    --v-radius:    18px;
    --v-radius-sm: 12px;
  }
  :root {
    /* Legacy alias names still used by existing rules. Point them at the
       --v-* tokens above so the palette has exactly one source of truth. */
    --bg:        var(--v-bg);
    --panel:     var(--v-surface);
    --surface:   var(--v-surface);
    --surface-2: var(--v-surface-2);
    --border:    var(--v-line);
    --line-2:    var(--v-line-2);
    --text:      var(--v-ink);
    --muted:     var(--v-ink-3);
    --accent:    var(--v-orange);
    --chronic:   var(--v-chronic);
    --emerging:  var(--v-emerging);
    --fading:    var(--v-fading);
  }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; height:100%; width:100%; background:var(--bg);
    color:var(--text); font-family:"Plus Jakarta Sans","Inter",system-ui,sans-serif;
    overflow:hidden; }
  header { padding:10px 16px; border-bottom:1px solid var(--border); background:var(--panel);
    display:flex; align-items:center; justify-content:space-between; }
  h1 { font-size:15px; margin:0; font-weight:600; }
  .subtitle { font-size:12px; color:var(--muted); margin-top:2px; }
  .stats { font-size:11px; color:var(--muted); }
  .stats b { color:var(--text); }
  main { position:fixed; top:52px; left:0; right:0; bottom:0;
    display:grid; grid-template-columns:360px 1fr 320px; }
  aside { overflow-y:auto; padding:12px 14px; border-right:1px solid var(--border);
    background:var(--panel); font-size:13px; }
  aside.right { border-right:none; border-left:1px solid var(--border); }
  aside.left h2 {
    font-size: 13px;
    font-weight: 700;
    margin: 14px 0 8px;
    color: var(--v-ink);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  aside.left h2 span { font-weight: 500; font-size: 11px; }
  aside h2:first-child { margin-top:0; }

  .card { background:var(--bg); border:1px solid var(--border); border-radius:5px;
    padding:8px 10px; margin-bottom:6px; cursor:pointer; transition:border-color .15s; }
  .card:hover { border-color:var(--accent); }
  .card.active { border-color:var(--accent); background:#FFF4EA; }
  .card-title { font-size:12px; font-weight:600; line-height:1.35; }
  .card-meta { font-size:10px; color:var(--muted); margin-top:3px; display:flex; gap:8px;
    flex-wrap:wrap; }
  .badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: var(--v-radius-sm);
    text-transform: uppercase;
    letter-spacing: .4px;
  }
  .badge.chronic  { background: #F9D9D9; color: var(--v-chronic); }
  .badge.emerging { background: var(--v-gold-soft); color: var(--v-emerging); }
  .badge.fading   { background: var(--v-line); color: var(--v-fading); }
  .badge.severity-high   { background: var(--v-rose-soft);   color: var(--v-chronic); }
  .badge.severity-medium { background: var(--v-gold-soft);   color: var(--v-emerging); }
  .badge.severity-low    { background: var(--v-mint-soft);   color: #3D8A6A; }
  .badge.sat-saturated   { background: var(--v-mint-soft);   color: #3D8A6A; }
  .badge.sat-adequate    { background: var(--v-sky-soft);    color: #3B6FA3; }
  .badge.sat-tentative   { background: var(--v-gold-soft);   color: var(--v-emerging); }
  .badge.sat-thin        { background: var(--v-line);        color: var(--v-ink-3); }
  .badge.variants        { background: var(--v-lavender-soft); color: #5C43A0; }
  .card-evidence { font-size:11px; color:var(--muted); margin-top:4px; font-style:italic;
    border-top:1px solid var(--border); padding-top:4px; }
  /* Category accent — a 3px left border in the role color helps users scan
     which kind of finding they're looking at without reading the pill. */
  #painpoints  .card { border-left: 3px solid var(--v-chronic); }
  #workarounds .card { border-left: 3px solid var(--v-mint); }
  #products    .card { border-left: 3px solid var(--v-emerging); }
  #features    .card { border-left: 3px solid var(--v-gold); }
  /* source distribution mini-bar on each card (triangulation at a glance) */
  .src-bar { display:flex; height:4px; border-radius:2px; overflow:hidden; margin-top:5px;
    background:var(--border); }
  .src-seg { height:100%; }
  .src-legend { display:flex; flex-wrap:wrap; gap:3px 6px; font-size:9px;
    color:var(--muted); margin-top:3px; }
  .src-legend span { display:inline-flex; align-items:center; gap:3px; }
  .src-legend i { width:6px; height:6px; border-radius:50%; display:inline-block; }

  /* Executive summary banner — always visible, addresses "stakeholders
     won't read long reports" (CHRONIC, 6 posts) */
  .exec {
    margin:0 14px 14px; padding:14px;
    background:linear-gradient(135deg,#FFF4EA 0%,#FBF8F2 100%);
    border:1px solid var(--accent); border-radius:8px;
  }
  .exec h2 { font-size:10px; color:var(--accent); letter-spacing:1px;
    margin:0 0 8px; text-transform:uppercase; }
  .exec-tl { font-size:13px; line-height:1.5; color:var(--text); margin:0 0 8px; }
  .exec-tl b { color:#1A1614; font-weight:700; }
  .exec-ul { font-size:11px; line-height:1.6; color:var(--text); margin:0; padding-left:18px; }
  .exec-ul li { margin-bottom:2px; }
  .exec-actions { display:flex; gap:6px; margin-top:10px; flex-wrap:wrap; }
  .exec-actions button {
    background:var(--panel); color:var(--text); border:1px solid var(--border);
    border-radius:6px; padding:5px 10px; cursor:pointer; font-size:11px;
  }
  .exec-actions button:hover { border-color:var(--accent); color:var(--accent); }
  .exec-actions button.copied { background:var(--accent); color:#fff; border-color:var(--accent); }

  .legend { display:flex; flex-wrap:wrap; gap:8px; font-size:10px; color:var(--muted);
    padding:6px 8px; background:var(--bg); border-radius:4px; border:1px solid var(--border);
    margin-bottom:10px; }
  .swatch { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:3px;
    vertical-align:middle; }
  .source-groups { display:flex; flex-direction:column; gap:8px; margin-bottom:10px; }
  .source-group { border:1px solid var(--border); background:var(--bg); border-radius:6px; padding:7px 8px; }
  .source-group-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .source-pill {
    display:inline-flex; align-items:center; gap:6px; font-size:10px; text-transform:uppercase;
    letter-spacing:.4px; font-weight:700; color:var(--text);
  }
  .source-pill i { width:8px; height:8px; border-radius:50%; display:inline-block; }
  .source-count { font-size:10px; color:var(--muted); }
  .source-group ul { margin:7px 0 0; padding-left:16px; font-size:11px; line-height:1.45; }
  .source-group li { margin:2px 0; }

  #graph { width:100%; height:100%; background:var(--bg); }
  .node { cursor:pointer; }
  .node circle { transition:stroke-width .15s; }
  .node.highlighted circle { stroke:#1A1614; stroke-width:3px; }
  .node.dimmed { opacity:0.18; }
  .link { stroke:#C9BEAA; stroke-opacity:0.45; }
  .link.highlighted { stroke:var(--accent); stroke-opacity:0.95; stroke-width:1.5px; }

  .details h3 { font-size:13px; margin:0 0 4px; font-weight:700; }
  .details .kind-pill { display:inline-block; font-size:9px; font-weight:700;
    background:var(--border); color:var(--text); padding:2px 6px; border-radius:3px;
    text-transform:uppercase; letter-spacing:.4px; }
  .details pre { white-space:pre-wrap; word-break:break-word; font-size:11px;
    color:var(--muted); max-height:280px; overflow-y:auto; background:var(--bg);
    padding:8px; border-radius:4px; border:1px solid var(--border); }
  .details .evidence-list { margin-top:10px; }
  .details .evidence-list a { display:block; padding:6px 8px; background:var(--bg);
    border:1px solid var(--border); border-radius:4px; margin-bottom:4px;
    color:var(--text); text-decoration:none; font-size:11px; line-height:1.35; }
  .details .evidence-list a:hover { border-color:var(--accent); color:var(--accent); }
  .details .evidence-list .ev-meta { color:var(--muted); font-size:10px; margin-top:2px; }
  .details .muted { color:var(--muted); }

  /* Node-detail panel — redesigned 2026-04-21 so clicks always show
     a meaningful "Linked to" section grouped by edge kind. */
  .details .node-detail-head { display:flex; align-items:center; gap:8px; margin-bottom:4px; }
  .details .node-id { font-family:ui-monospace,monospace; font-size:10px; color:var(--muted); }
  .details .node-title { font-size:14px; font-weight:700; margin:4px 0 8px; line-height:1.3; }
  .details .node-meta-block { background:var(--bg); border:1px solid var(--border);
    border-radius:4px; padding:8px 10px; margin:6px 0 10px; font-size:12px; }
  .details .node-meta-row { display:flex; gap:8px; margin:2px 0; line-height:1.4; }
  .details .node-meta-row b { flex:0 0 88px; color:var(--muted); font-weight:600;
    text-transform:uppercase; font-size:10px; letter-spacing:.4px; padding-top:2px; }
  .details .node-meta-row span { flex:1; color:var(--text); }
  .details .node-section-title { font-size:11px; margin:14px 0 6px; color:var(--muted);
    text-transform:uppercase; letter-spacing:.4px; font-weight:700; }
  .details .edge-group { margin-bottom:8px; }
  .details .edge-group-head { font-size:11px; font-weight:700; color:var(--text);
    margin-bottom:4px; padding:2px 0; }
  .details .edge-group-body { display:flex; flex-direction:column; gap:2px; }
  .details .neighbor-row { display:flex; align-items:center; gap:6px; padding:4px 6px;
    background:var(--bg); border:1px solid var(--border); border-radius:3px;
    cursor:pointer; font-size:11px; transition:border-color .12s, background .12s; }
  .details .neighbor-row:hover { border-color:var(--accent); background:color-mix(in srgb, var(--accent) 6%, var(--bg)); }
  .details .neighbor-arrow { color:var(--muted); font-weight:600; flex:0 0 12px; }
  .details .neighbor-kind { color:var(--muted); font-size:9px; text-transform:uppercase;
    letter-spacing:.4px; flex:0 0 auto; background:var(--border); padding:1px 5px;
    border-radius:2px; }
  .details .neighbor-label { flex:1; color:var(--text); overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; }
  .details .neighbor-row .ext-link { flex:0 0 auto; color:var(--accent);
    text-decoration:none; font-size:12px; }
  .details .node-meta-raw { margin-top:12px; }
  .details .node-meta-raw summary { font-size:10px; color:var(--muted);
    text-transform:uppercase; letter-spacing:.4px; cursor:pointer; padding:4px 0;
    font-weight:700; }
  .details .node-meta-raw[open] summary { margin-bottom:4px; }

  .controls { display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap; }
  .controls button, .controls label { background:var(--bg); color:var(--text);
    border:1px solid var(--border); border-radius:3px; padding:3px 8px; cursor:pointer;
    font-size:11px; user-select:none; }
  .controls input { margin-right:4px; vertical-align:middle; }

  /* ── graphify-style lens controls ─────────────────────────────────────── */
  .lenses {
    display:flex; flex-wrap:wrap; gap:5px; margin: 4px 0 12px;
    padding: 8px; background: var(--surface-2);
    border:1px solid var(--border); border-radius:8px;
  }
  .lenses #graphSearch {
    flex: 1 1 100%;
    background: var(--bg); color: var(--text);
    border: 1px solid var(--border); border-radius: 5px;
    padding: 5px 8px; font-size: 11px;
    margin-bottom: 4px;
  }
  .lenses #graphSearch:focus { outline:none; border-color: var(--accent); }
  .lens-btn {
    background: var(--bg); color: var(--text);
    border: 1px solid var(--border); border-radius: 14px;
    padding: 3px 9px; font-size: 11px; cursor: pointer;
    user-select: none; transition: all .15s;
  }
  .lens-btn:hover { border-color: var(--accent); color: var(--accent); }
  .lens-btn.active {
    background: var(--accent); color: #fff; border-color: var(--accent);
  }

  /* Edge styling by graphify-style confidence. Set via class on the line. */
  .link.confidence-EXTRACTED { stroke-dasharray: none; }
  .link.confidence-INFERRED  { stroke-dasharray: 5 3; }
  .link.confidence-AMBIGUOUS { stroke-dasharray: 1 3; stroke-opacity: 0.32; }
  /* Surprising-connections lens: thick orange outline on cross-community edges */
  .link.surprising { stroke: var(--accent) !important; stroke-width: 2.5px !important; stroke-opacity: 0.85 !important; }
  /* Lens dim — used for non-matched nodes/edges when a lens is active */
  .node.dim circle { opacity: 0.18; }
  .node.dim text { opacity: 0.18; }
  .link.dim { stroke-opacity: 0.08 !important; }
  /* Knowledge-gap and bridge highlights: extra stroke + glow on circles. */
  .node.gap circle { stroke: var(--v-chronic); stroke-width: 3.5px; }
  .node.bridge circle { stroke: var(--v-mint); stroke-width: 3.5px;
    filter: drop-shadow(0 0 4px var(--v-mint)); }
  /* Community ring — appended as a second circle; coloured per community. */
  .community-ring { fill: none; stroke-width: 2; opacity: 0.85; pointer-events: none; }

  .empty { color:var(--muted); font-size:11px; font-style:italic; padding:4px; }

  footer { position:fixed; bottom:4px; right:10px; font-size:9px; color:var(--muted); }
  footer a { color:var(--muted); text-decoration:underline; }
</style>
</head>
<body>
<header>
  <div>
    <h1>Gap Map — {TOPIC}</h1>
    <div class="subtitle" id="subtitle"></div>
  </div>
  <div class="stats" id="statsLine"></div>
</header>
<main>
  <aside class="left">
    <!-- EXEC SUMMARY — addresses "stakeholders won't read long reports" (CHRONIC) -->
    <div class="exec" id="exec">
      <h2>Executive summary</h2>
      <div class="exec-tl" id="execThesis"></div>
      <ol class="exec-ul" id="execTop3"></ol>
      <div class="exec-actions">
        <button id="copyTweet">📋 Copy as tweet</button>
        <button id="copyMd">📋 Copy as markdown</button>
        <button id="savePng">📸 Save as PNG</button>
      </div>
    </div>

    <div class="legend" id="legend"></div>
    <h2>Top insights by source</h2>
    <div id="sourceTopInsights" class="source-groups"></div>

    <h2>🔥 Painpoints <span id="ppCount" style="color:var(--muted);font-weight:400"></span></h2>
    <div id="painpoints"></div>

    <h2>🛠 DIY workarounds <span style="color:var(--muted);font-weight:400">· gap signal</span></h2>
    <div id="workarounds"></div>

    <h2>😡 Products complained about</h2>
    <div id="products"></div>

    <h2>💡 Feature wishes</h2>
    <div id="features"></div>
  </aside>

  <svg id="graph"></svg>

  <aside class="right">
    <div class="controls">
      <button id="resetZoom">Reset zoom</button>
      <label><input type="checkbox" id="showUsers"> Show users</label>
    </div>
    <!-- graphify-style insight lenses: surprising / gaps / bridges
         + a search box. All toggle-style overlays on the same graph. -->
    <div class="lenses" id="lenses">
      <input type="search" id="graphSearch" placeholder="Search findings…" />
      <button class="lens-btn" id="lensSurprising" title="Highlight cross-community edges (the unexpected connections)">⚡ Surprising</button>
      <button class="lens-btn" id="lensGaps" title="Highlight painpoints with no candidate solver in the graph">🕳 Gaps</button>
      <button class="lens-btn" id="lensBridges" title="Highlight findings triangulated across ≥3 source kinds">🌉 Bridges</button>
      <button class="lens-btn" id="lensConfidence" title="Cycle edge filter by graphify-style confidence">⊕ All edges</button>
      <button class="lens-btn" id="lensCommunities" title="Color nodes by community membership">🎨 Communities</button>
    </div>
    <div id="details" class="details">
      <p class="empty">Click any finding on the left — the graph zooms to its evidence and this panel shows the posts.</p>
    </div>
  </aside>
</main>
<footer>gapmap · gap map · <a href="https://github.com/shaantanu98/reddit-myind/blob/master/docs/methodology.md" target="_blank">methodology</a></footer>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.13/html-to-image.min.js"></script>
<script>
const DATA = {GRAPH_JSON};

// Tuned for the cream (#F6F3EE) background — saturated enough to stand out,
// aligned with the app's soft-dashboard accent tokens (orange / lavender /
// sky / mint / rose). Avoid light-on-light pairings that wash out on cream.
const KIND_COLORS = {
  topic:"#FF8C42",        // app orange — the brand/root
  subreddit:"#8B6FD4",    // deepened lavender (app lavender would wash out)
  post:"#4A90C4",         // deepened sky (app sky too light)
  comment:"#5FA6D9",      // sky-ish
  user:"#5FB88C",         // deepened mint
  era:"#9C948A",          // fading gray (app ink-3 adjacent)
  painpoint:"#E26A6A",    // app chronic
  feature_wish:"#E69447", // app emerging
  product:"#D48BA6",      // deepened rose
  workaround:"#7DC9A3",   // deepened mint
  document:"#A371F7",
  document_element:"#79C0FF",
};
const KIND_LABEL = {
  topic:"Topic", subreddit:"Subreddit", post:"Post", comment:"Comment",
  user:"User", era:"Era", painpoint:"Painpoint", feature_wish:"Feature wish",
  product:"Product", workaround:"DIY workaround", document:"Document",
  document_element:"Document element",
};

// ── header stats + subtitle ──
const meta = DATA.meta;
const pp = DATA.findings.painpoint || [];
const cs = meta.classification_summary || {};
document.getElementById("subtitle").textContent =
  `${pp.length} painpoints · ${(DATA.findings.product||[]).length} products complained about · ` +
  `${(DATA.findings.workaround||[]).length} DIY workarounds · ${(DATA.findings.feature_wish||[]).length} feature wishes`;
const renderedCount = meta.rendered_nodes || meta.total_nodes;
const rendersuffix = meta.render_mode === "skeleton" && meta.total_nodes > renderedCount
  ? ` <span style="color:var(--muted)">(skeleton of ${meta.total_nodes.toLocaleString()} total)</span>`
  : "";
document.getElementById("statsLine").innerHTML =
  `<b>${renderedCount}</b> nodes · <b>${meta.rendered_edges || meta.total_edges}</b> edges${rendersuffix} · ` +
  `${cs.CHRONIC||0} chronic · ${cs.EMERGING||0} emerging · ${cs.FADING||0} fading · ` +
  `${meta.generated_at.replace('T',' ').split('+')[0]} UTC`;

// ── legend ──
const legendEl = document.getElementById("legend");
["painpoint","workaround","product","feature_wish","subreddit","post","user","era","topic"].forEach(k => {
  if (!(meta.nodes_by_kind||{})[k]) return;
  const span = document.createElement("span");
  span.innerHTML = `<span class="swatch" style="background:${KIND_COLORS[k]}"></span>${KIND_LABEL[k]}`;
  legendEl.appendChild(span);
});

// ── findings columns ──
// Source-distribution bar — visual "triangulation at a glance" per card.
// Implements Shneiderman's "details on demand" + Tufte data-ink (4px height).
function srcBarHtml(sourceBreakdown) {
  if (!sourceBreakdown) return "";
  const entries = Object.entries(sourceBreakdown);
  if (!entries.length) return "";
  const total = entries.reduce((s,[_,n])=>s+n, 0);
  const srcColors = {
    reddit:"#ff4500", hn:"#ff6600", appstore:"#58a6ff", playstore:"#3fb950",
    arxiv:"#d2a8ff", openalex:"#a371f7", pubmed:"#7ee787", scholar:"#c9d1d9",
    gnews:"#ffa657", devto:"#79c0ff", lemmy:"#7ee787", mastodon:"#a371f7",
    github:"#f778ba", github_issue:"#f85149", stackoverflow:"#ffa657",
  };
  const segs = entries.map(([s,n]) => {
    const pct = (n/total*100).toFixed(1);
    const c = srcColors[s] || "#7d8590";
    return `<div class="src-seg" style="width:${pct}%;background:${c}" title="${s}: ${n}"></div>`;
  }).join("");
  const legend = entries.map(([s,n]) => {
    const c = srcColors[s] || "#7d8590";
    return `<span><i style="background:${c}"></i>${s} ${n}</span>`;
  }).join("");
  return `<div class="src-bar">${segs}</div><div class="src-legend">${legend}</div>`;
}

function renderFinding(node, onclick) {
  const md = node.metadata || {};
  const title = (node.label || "(unnamed)").replace(/</g,"&lt;");
  const classification = md.classification;
  const severity = md.severity;
  const freq = md.frequency;
  const evCount = node.evidence_count || 0;
  const sourceBreakdown = node.source_breakdown || {};
  let badges = "";
  if (classification && classification !== "UNCLASSIFIED")
    badges += `<span class="badge ${classification.toLowerCase()}">${classification}</span>`;
  if (severity) badges += `<span class="badge severity-${severity}">${severity} sev</span>`;
  if ((md.aliases || []).length) {
    const count = md.aliases.length;
    const tip = `Merged with: ${md.aliases.join(' · ')}`;
    badges += `<span class="badge variants" title="${tip.replace(/"/g,'&quot;')}">+${count} variants</span>`;
  }
  // Saturation badge — Guest/Bunce/Johnson 2006 confidence signal.
  // Explicit hover tooltip explains the math so users can verify.
  const sat = node.saturation;
  if (sat && sat.confidence) {
    const tip = `${sat.n_evidence} evidence across ${sat.source_diversity} source(s); ${sat.unique_authors} unique authors. Thresholds: saturated ≥12 & ≥2 sources, adequate ≥8 & ≥2, tentative ≥4, else thin.`;
    const icon = sat.confidence === "saturated" ? "✓" : sat.confidence === "adequate" ? "≈" : sat.confidence === "tentative" ? "⚠" : "·";
    badges += `<span class="badge sat-${sat.confidence}" title="${tip.replace(/"/g,'&quot;')}">${icon} ${sat.confidence}</span>`;
  }

  const card = document.createElement("div");
  card.className = "card";
  card.dataset.nodeId = node.id;
  card.innerHTML = `
    <div class="card-title">${title}</div>
    <div class="card-meta">
      ${badges}
      ${freq ? `<span>freq: ${freq}</span>` : ""}
      ${evCount ? `<span>📎 ${evCount} evidence</span>` : ""}
    </div>
    ${md.evidence || md.user_quote || md.complaint ? `<div class="card-evidence">${(md.evidence||md.user_quote||md.complaint).replace(/</g,"&lt;")}</div>` : ""}
    ${srcBarHtml(sourceBreakdown)}
  `;
  card.addEventListener("click", () => onclick(node));
  return card;
}

// ── Executive summary renderer ──
// 3 punchy findings + 1 DIY + share buttons. Stakeholders who won't read
// the full report read THIS (Guest/Bunce saturation + Tufte compression).
function renderExec() {
  const pps = (DATA.findings.painpoint || []).slice(0, 3);
  const topDiy = (DATA.findings.workaround || [])[0];
  const topProducts = (DATA.findings.product || []).slice(0, 3).map(p => p.label);
  const topicName = DATA.meta.topic;

  if (!pps.length) {
    document.getElementById("exec").style.display = "none";
    return;
  }

  const thesisParts = [];
  thesisParts.push(
    `Across <b>${DATA.meta.total_nodes.toLocaleString()}</b> signals from <b>${Object.keys(DATA.meta.nodes_by_kind||{}).length}</b> node kinds, the pattern in <b>${topicName}</b> is clear:`
  );
  const execThesisEl = document.getElementById("execThesis");
  execThesisEl.innerHTML = thesisParts.join(" ");

  const ol = document.getElementById("execTop3");
  pps.forEach(pp => {
    const md = pp.metadata || {};
    const cls = md.classification && md.classification !== "UNCLASSIFIED"
      ? `<span class="badge ${md.classification.toLowerCase()}" style="margin-left:4px">${md.classification}</span>`
      : "";
    const li = document.createElement("li");
    li.innerHTML = `${pp.label}${cls}`;
    ol.appendChild(li);
  });

  if (topDiy) {
    const li = document.createElement("li");
    li.style.marginTop = "6px";
    li.innerHTML = `<span style="color:var(--muted)">Users hack around with:</span> <b>${topDiy.label}</b>`;
    ol.appendChild(li);
  }
  if (topProducts.length) {
    const li = document.createElement("li");
    li.innerHTML = `<span style="color:var(--muted)">Named competitors:</span> ${topProducts.join(", ")}`;
    ol.appendChild(li);
  }

  // Copy buttons
  const tweet = (() => {
    const lines = [`Gap map — ${topicName}:`, ""];
    pps.forEach((p, i) => {
      const cls = (p.metadata||{}).classification;
      lines.push(`${i+1}. ${p.label}${cls && cls !== "UNCLASSIFIED" ? " ["+cls+"]" : ""}`);
    });
    if (topDiy) {
      lines.push("", `Users hack around this with: ${topDiy.label}`);
    }
    return lines.join("\\n");
  })();

  const markdown = (() => {
    const lines = [`# Gap Map — ${topicName}`, ""];
    lines.push(`**Top painpoints:**`);
    pps.forEach((p, i) => {
      const md = p.metadata || {};
      const cls = md.classification && md.classification !== "UNCLASSIFIED" ? " **"+md.classification+"**" : "";
      lines.push(`${i+1}. ${p.label}${cls}`);
      if (md.evidence) lines.push(`   > ${md.evidence}`);
    });
    if (topDiy) {
      lines.push("", `**Biggest gap signal (DIY workaround):** ${topDiy.label}`);
    }
    if (topProducts.length) {
      lines.push("", `**Named competitors:** ${topProducts.join(", ")}`);
    }
    return lines.join("\\n");
  })();

  function flashButton(btn, label) {
    const orig = btn.textContent;
    btn.textContent = label;
    btn.classList.add("copied");
    setTimeout(() => { btn.textContent = orig; btn.classList.remove("copied"); }, 1500);
  }
  document.getElementById("copyTweet").addEventListener("click", e => {
    navigator.clipboard.writeText(tweet);
    flashButton(e.target, "✓ Copied!");
  });
  document.getElementById("copyMd").addEventListener("click", e => {
    navigator.clipboard.writeText(markdown);
    flashButton(e.target, "✓ Copied!");
  });
  // Save as PNG — snapshot the exec block, download with topic-slug filename
  document.getElementById("savePng").addEventListener("click", async e => {
    if (typeof htmlToImage === "undefined") {
      flashButton(e.target, "⚠ library not loaded");
      return;
    }
    const btn = e.target;
    const orig = btn.textContent;
    btn.textContent = "rendering…";
    try {
      const dataUrl = await htmlToImage.toPng(document.getElementById("exec"), {
        backgroundColor: "#F6F3EE",
        pixelRatio: 2,
      });
      const slug = (DATA.meta.topic || "gap-map").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const link = document.createElement("a");
      link.download = `gap-map-${slug}.png`;
      link.href = dataUrl;
      link.click();
      flashButton(btn, "✓ Saved!");
    } catch (err) {
      console.error(err);
      btn.textContent = orig;
      alert("PNG export failed: " + err.message);
    }
  });
}
renderExec();

const findingsPanels = {
  painpoints: DATA.findings.painpoint || [],
  workarounds: DATA.findings.workaround || [],
  products: DATA.findings.product || [],
  features: DATA.findings.feature_wish || [],
};

document.getElementById("ppCount").textContent = `(${findingsPanels.painpoints.length})`;

function renderSourceWiseTopInsights() {
  const sourceHost = document.getElementById("sourceTopInsights");
  const sourceColors = {
    reddit:"#ff4500", hn:"#ff6600", appstore:"#58a6ff", playstore:"#3fb950",
    arxiv:"#d2a8ff", openalex:"#a371f7", pubmed:"#7ee787", scholar:"#c9d1d9",
    gnews:"#ffa657", devto:"#79c0ff", lemmy:"#7ee787", mastodon:"#a371f7",
    github:"#f778ba", github_issue:"#f85149", stackoverflow:"#ffa657",
  };
  const allFindings = [
    ...findingsPanels.painpoints,
    ...findingsPanels.workarounds,
    ...findingsPanels.products,
    ...findingsPanels.features,
  ];
  const bySource = new Map();
  for (const finding of allFindings) {
    const breakdown = finding.source_breakdown || {};
    for (const [source, count] of Object.entries(breakdown)) {
      const n = Number(count || 0);
      if (!n) continue;
      if (!bySource.has(source)) bySource.set(source, []);
      bySource.get(source).push({
        node: finding,
        evidence: n,
        totalEvidence: Number(finding.evidence_count || 0),
      });
    }
  }

  const groups = Array.from(bySource.entries())
    .map(([source, items]) => {
      items.sort((a, b) => (
        (b.evidence - a.evidence) ||
        (b.totalEvidence - a.totalEvidence) ||
        String(a.node.label || "").localeCompare(String(b.node.label || ""))
      ));
      return {
        source,
        sourceEvidence: items.reduce((s, it) => s + it.evidence, 0),
        items: items.slice(0, 3),
      };
    })
    .sort((a, b) => b.sourceEvidence - a.sourceEvidence);

  if (!groups.length) {
    sourceHost.innerHTML = '<p class="empty">No source-level evidence yet. Run enrich to populate this.</p>';
    return;
  }

  sourceHost.innerHTML = "";
  groups.forEach(group => {
    const color = sourceColors[group.source] || "#7d8590";
    const wrap = document.createElement("div");
    wrap.className = "source-group";
    const listHtml = group.items.map((it) => {
      const label = String(it.node.label || "(unnamed)").replace(/</g, "&lt;");
      return `<li>${label} <span class="source-count">(${it.evidence} evidence)</span></li>`;
    }).join("");
    wrap.innerHTML = `
      <div class="source-group-head">
        <span class="source-pill"><i style="background:${color}"></i>${group.source}</span>
        <span class="source-count">${group.sourceEvidence} total evidence</span>
      </div>
      <ul>${listHtml}</ul>
    `;
    sourceHost.appendChild(wrap);
  });
}
renderSourceWiseTopInsights();

function selectNodeById(nodeId) {
  const node = nodesById[nodeId];
  if (!node) return;
  showNodeDetails(node);
  highlightNode(node);
  zoomToNode(node);
  document.querySelectorAll(".card").forEach(c => c.classList.toggle("active", c.dataset.nodeId === nodeId));
}

["painpoints","workarounds","products","features"].forEach(key => {
  const container = document.getElementById(key);
  const items = findingsPanels[key];
  if (!items.length) { container.innerHTML = '<p class="empty">none found</p>'; return; }
  items.forEach(n => container.appendChild(renderFinding(n, node => selectNodeById(node.id))));
});

// ── graph ──
const svg = d3.select("#graph");
const svgEl = svg.node();
const width = svgEl.clientWidth;
const height = svgEl.clientHeight;
const g = svg.append("g");
const zoom = d3.zoom().scaleExtent([0.1, 8]).on("zoom", e => g.attr("transform", e.transform));
svg.call(zoom);
document.getElementById("resetZoom").onclick = () =>
  svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);

function zoomToNode(node) {
  if (!node.x || !node.y) return;
  const scale = 2.2;
  const tx = width/2 - node.x * scale;
  const ty = height/2 - node.y * scale;
  svg.transition().duration(450).call(
    zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale)
  );
}

const nodesById = Object.fromEntries(DATA.nodes.map(n => [n.id, {...n}]));
const links = DATA.links.map(l => ({...l}));

const showUsers = {current: false};
function shouldShow(node) {
  if (!showUsers.current && node.kind === "user") return false;
  return true;
}

function radiusOf(d) {
  if (d.kind === "topic") return 16;
  if (d.kind === "painpoint") return 10;
  if (d.kind === "product" || d.kind === "workaround" || d.kind === "feature_wish") return 9;
  if (d.kind === "subreddit" || d.kind === "source") return 7;
  if (d.kind === "era") return 12;
  if (d.kind === "post") return 3;
  if (d.kind === "user") return 2.5;
  return 3;
}

// Radial placement by kind — anchors the graph so the eye finds structure.
// Each kind lives in a concentric ring: topic center, semantic nodes inner,
// subs/sources middle, evidence posts outer.
const KIND_RADII = {
  topic: 0,
  era: 70,
  painpoint: 140,
  product: 200,
  workaround: 200,
  feature_wish: 200,
  subreddit: 300,
  source: 300,
  post: 420,
  user: 480,
  comment: 480,
};

const sim = d3.forceSimulation(Object.values(nodesById))
  .force("link", d3.forceLink(links).id(d => d.id).distance(d => {
    if (d.kind === "evidenced_by" || d.kind === "wished_in" || d.kind === "built_in") return 35;
    if (d.kind === "about_product" || d.kind === "solves") return 30;
    if (d.kind === "source_evidence") return 90;  // painpoint ↔ source — keep distinct from post citations
    return 50;
  }).strength(0.4))
  .force("charge", d3.forceManyBody().strength(d => {
    if (["painpoint","product","workaround","feature_wish"].includes(d.kind)) return -280;
    if (["subreddit","source","era"].includes(d.kind)) return -180;
    if (d.kind === "topic") return -400;
    return -50;
  }))
  .force("center", d3.forceCenter(width/2, height/2).strength(0.02))
  .force("radial", d3.forceRadial(
    d => KIND_RADII[d.kind] ?? 200,
    width/2, height/2,
  ).strength(0.35))
  .force("collide", d3.forceCollide(d => radiusOf(d) + 3));

const linkSel = g.append("g").attr("stroke","#C9BEAA")
  .selectAll("line").data(links).join("line")
  .attr("class", d => d.kind === "source_evidence" ? "link source-link" : "link")
  // Cross-source edges (painpoint ↔ source) get stroke width proportional
  // to weight — a painpoint backed by 12 reddit posts gets a thicker edge
  // than one with 3 arxiv hits. Caps at 5px so a viral painpoint doesn't
  // obliterate the rest of the graph. Other edges stay at default 1px.
  .attr("stroke-width", d => {
    if (d.kind === "source_evidence") {
      const w = Math.max(1, Math.min(5, Math.log2((d.weight || 1) + 1) + 1));
      return w;
    }
    return 1;
  })
  .attr("stroke", d => d.kind === "source_evidence" ? "#FF8C42" : "#C9BEAA")
  .attr("stroke-opacity", d => d.kind === "source_evidence" ? 0.65 : 0.45);

const nodeSel = g.append("g").selectAll("g")
  .data(Object.values(nodesById)).join("g").attr("class","node");
nodeSel.append("circle")
  .attr("r", radiusOf)
  .attr("fill", d => KIND_COLORS[d.kind] || "#888")
  .attr("stroke", "#F6F3EE").attr("stroke-width", 1.2);

nodeSel.append("title").text(d => `${d.label}  [${d.kind}]`);
nodeSel.append("text")
  .attr("x", d => radiusOf(d) + 3).attr("y", 3)
  .style("font-size","10px").style("fill","#1A1614").style("pointer-events","none")
  .text(d => (["topic","painpoint","product","workaround","feature_wish"].includes(d.kind))
              ? (d.label||"").slice(0,40) : "");

nodeSel.on("click", (e, d) => selectNodeById(d.id));
nodeSel.call(d3.drag()
  .on("start", (e,d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
  .on("drag",  (e,d) => { d.fx=e.x; d.fy=e.y; })
  .on("end",   (e,d) => { if (!e.active) sim.alphaTarget(0); d.fx=null; d.fy=null; }));

sim.on("tick", () => {
  linkSel.attr("x1", d=>d.source.x).attr("y1", d=>d.source.y)
         .attr("x2", d=>d.target.x).attr("y2", d=>d.target.y);
  nodeSel.attr("transform", d => `translate(${d.x},${d.y})`);
});

// ── user visibility toggle ──
document.getElementById("showUsers").addEventListener("change", e => {
  showUsers.current = e.target.checked;
  nodeSel.style("display", d => shouldShow(d) ? null : "none");
  linkSel.style("display", l => {
    const s = typeof l.source === "object" ? l.source : nodesById[l.source];
    const t = typeof l.target === "object" ? l.target : nodesById[l.target];
    return (shouldShow(s) && shouldShow(t)) ? null : "none";
  });
});
// Apply initial visibility
nodeSel.style("display", d => shouldShow(d) ? null : "none");
linkSel.style("display", l => {
  const s = typeof l.source === "object" ? l.source : nodesById[l.source];
  const t = typeof l.target === "object" ? l.target : nodesById[l.target];
  return (shouldShow(s) && shouldShow(t)) ? null : "none";
});

// ── highlighting ──
function neighborIds(nodeId) {
  const s = new Set([nodeId]);
  links.forEach(l => {
    const sid = typeof l.source === "object" ? l.source.id : l.source;
    const tid = typeof l.target === "object" ? l.target.id : l.target;
    if (sid === nodeId) s.add(tid);
    if (tid === nodeId) s.add(sid);
  });
  return s;
}

function highlightNode(node) {
  const n = neighborIds(node.id);
  nodeSel.classed("dimmed", d => !n.has(d.id)).classed("highlighted", d => d.id === node.id);
  linkSel.classed("highlighted", l => {
    const sid = typeof l.source === "object" ? l.source.id : l.source;
    const tid = typeof l.target === "object" ? l.target.id : l.target;
    return sid === node.id || tid === node.id;
  });
}

// ── details panel ──
// Human-readable labels for common edge kinds. Unknown edges fall back
// to the raw kind string so nothing is silently hidden.
const EDGE_LABEL = {
  evidenced_by:      "Evidenced by",
  wished_in:         "Wished in",
  about_product:     "About product",
  built_in:          "Built in",
  source_evidence:   "Source evidence",
  relates_to:        "Relates to",
  co_evidenced:      "Co-evidenced with",
  potentially_solves:"Potentially solves",
  could_address:     "Could address",
  has_painpoint:     "Has painpoint",
  has_feature_wish:  "Feature wish",
  has_workaround:    "Workaround",
  has_product:       "Product",
  has_temporal_gap:  "Temporal gap",
  supports:          "Supports",
  has_source_doc:    "Has source doc",
  has_source_element:"Has source element",
  addresses:         "Addresses",
  cites:             "Cites",
  similar_to:        "Similar to",
  mentions:          "Mentions",
  posted_by:         "Posted by",
  posted_in:         "Posted in",
};

const ESC_MAP = {"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;"};
ESC_MAP['"'] = "&quot;";
function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"']/g, c => ESC_MAP[c]); }

function _neighborsOf(nodeId) {
  // Returns { edgeKind: [{ neighbor, dir }] } for every edge touching nodeId.
  const out = {};
  links.forEach(l => {
    const sid = typeof l.source === "object" ? l.source.id : l.source;
    const tid = typeof l.target === "object" ? l.target.id : l.target;
    if (sid !== nodeId && tid !== nodeId) return;
    const neighborId = sid === nodeId ? tid : sid;
    const neighbor = nodesById[neighborId];
    if (!neighbor) return;
    const kind = l.kind || "related_to";
    (out[kind] ??= []).push({ neighbor, dir: sid === nodeId ? "out" : "in" });
  });
  return out;
}

function showNodeDetails(node) {
  const md = node.metadata || {};
  const host = document.getElementById("details");
  const title = esc(node.label || "(unnamed)");
  const kindLabel = esc(KIND_LABEL[node.kind] || node.kind);

  let html = `
    <div class="node-detail-head">
      <span class="kind-pill">${kindLabel}</span>
      ${node.id ? `<span class="node-id" title="${esc(node.id)}">${esc((node.id || "").slice(0, 12))}${(node.id || "").length > 12 ? "…" : ""}</span>` : ""}
    </div>
    <h3 class="node-title">${title}</h3>
  `;

  // High-value metadata promoted to the top for semantic nodes.
  const preview = [];
  if (md.summary)    preview.push(`<div class="node-meta-row"><b>Summary</b><span>${esc(md.summary)}</span></div>`);
  if (md.evidence)   preview.push(`<div class="node-meta-row"><b>Evidence</b><span>"${esc(md.evidence)}"</span></div>`);
  if (md.importance != null) preview.push(`<div class="node-meta-row"><b>Importance</b><span>${esc(md.importance)}/10</span></div>`);
  if (md.satisfaction != null) preview.push(`<div class="node-meta-row"><b>Satisfaction</b><span>${esc(md.satisfaction)}/10</span></div>`);
  if (md.frequency != null) preview.push(`<div class="node-meta-row"><b>Frequency</b><span>${esc(md.frequency)} posts</span></div>`);
  if (md.classification) preview.push(`<div class="node-meta-row"><b>Classification</b><span>${esc(md.classification)}</span></div>`);
  if (md.source_breakdown && typeof md.source_breakdown === "object") {
    const entries = Object.entries(md.source_breakdown).sort((a, b) => (b[1] - a[1]));
    if (entries.length) {
      const srcSummary = entries.map(([s, n]) => `${s}: ${n}`).join(" · ");
      preview.push(`<div class="node-meta-row"><b>Sources</b><span>${esc(srcSummary)}</span></div>`);
    }
  }
  if (preview.length) html += `<div class="node-meta-block">${preview.join("")}</div>`;

  // Neighbors grouped by edge kind — this is the "linked to" section.
  const groups = _neighborsOf(node.id);
  const groupKeys = Object.keys(groups).sort((a, b) => (groups[b].length - groups[a].length));
  const relationKinds = ["related_to", "potentially_solves", "could_address", "source_evidence"];
  const relationTotal = relationKinds.reduce((n, k) => n + ((groups[k] || []).length), 0);
  if (relationTotal > 0) {
    const relParts = relationKinds
      .filter((k) => (groups[k] || []).length > 0)
      .map((k) => `${(EDGE_LABEL[k] || k)}: ${(groups[k] || []).length}`);
    html += `<div class="node-meta-block"><div class="node-meta-row"><b>Relations</b><span>${esc(relParts.join(" · "))}</span></div></div>`;
  }
  if (groupKeys.length) {
    html += `<h3 class="node-section-title">Linked to · <span class="muted">${groupKeys.reduce((n, k) => n + groups[k].length, 0)} edges</span></h3>`;
    groupKeys.forEach(kind => {
      const items = groups[kind];
      const label = esc(EDGE_LABEL[kind] || kind.replace(/_/g, " "));
      const rows = items.slice(0, 12).map(({ neighbor, dir }) => {
        const nkLabel = esc(KIND_LABEL[neighbor.kind] || neighbor.kind);
        const nTitle = esc(neighbor.label || "(unnamed)");
        const arrow = dir === "out" ? "→" : "←";
        const nmd = neighbor.metadata || {};
        const permalink = nmd.permalink || nmd.url;
        const permalinkHtml = permalink
          ? ` <a href="${esc(permalink)}" target="_blank" rel="noopener" class="ext-link" title="Open source">↗</a>`
          : "";
        return `<div class="neighbor-row" data-node-id="${esc(neighbor.id)}">
          <span class="neighbor-arrow">${arrow}</span>
          <span class="neighbor-kind">${nkLabel}</span>
          <span class="neighbor-label">${nTitle}</span>${permalinkHtml}
        </div>`;
      }).join("");
      const overflow = items.length > 12
        ? `<div class="muted" style="font-size:11px;padding:4px 2px">+ ${items.length - 12} more</div>`
        : "";
      html += `
        <div class="edge-group">
          <div class="edge-group-head">${label} <span class="muted">(${items.length})</span></div>
          <div class="edge-group-body">${rows}${overflow}</div>
        </div>
      `;
    });
  } else {
    html += `<div class="muted" style="font-size:12px;margin-top:10px">No edges touch this node yet. Re-run enrich or rebuild to connect it.</div>`;
  }

  // Evidence posts — kept as a dedicated section for semantic nodes so
  // posts stay quick to scan even if other edge kinds dominate the list.
  if (["painpoint","product","workaround","feature_wish","temporal_gap"].includes(node.kind)) {
    const evidenceIds = new Set();
    links.forEach(l => {
      const sid = typeof l.source === "object" ? l.source.id : l.source;
      const tid = typeof l.target === "object" ? l.target.id : l.target;
      if (["evidenced_by","wished_in","about_product","built_in"].includes(l.kind)) {
        if (sid === node.id) evidenceIds.add(tid);
        if (tid === node.id) evidenceIds.add(sid);
      }
    });
    const posts = [...evidenceIds].map(id => nodesById[id]).filter(n => n && n.kind === "post");
    if (posts.length) {
      html += `<h3 class="node-section-title">📎 Evidence posts <span class="muted">(${posts.length})</span></h3>`;
      html += `<div class="evidence-list">`;
      posts.forEach(p => {
        const pmd = p.metadata || {};
        const score = pmd.score != null ? `${pmd.score}↑` : "";
        const comments = pmd.num_comments != null ? `${pmd.num_comments}💬` : "";
        const src = pmd.sub || pmd.source_type || "?";
        html += `<a href="${esc(pmd.permalink || pmd.url || '#')}" target="_blank" rel="noopener">
          <div>${esc(p.label || '')}</div>
          <div class="ev-meta">${esc(src)} · ${esc(score)} ${esc(comments)}</div>
        </a>`;
      });
      html += `</div>`;
    }
  }

  html += `<details class="node-meta-raw"><summary>Raw metadata</summary><pre>${esc(JSON.stringify(md, null, 2))}</pre></details>`;
  if (md.permalink) html += `<div style="margin-top:8px"><a href="${esc(md.permalink)}" target="_blank" style="color:var(--accent)">Open source ↗</a></div>`;
  host.innerHTML = html;

  // Clicking a neighbor row jumps to that node — turns the panel into
  // a keyboard-free way to walk the graph.
  host.querySelectorAll(".neighbor-row[data-node-id]").forEach(el => {
    el.addEventListener("click", () => selectNodeById(el.dataset.nodeId));
  });
}

// ───────────────────────────────────────────────────────────────────────────
// graphify-style additive lenses (2026-05-28). Everything below is purely
// additive — touches only newly-introduced DOM nodes and adds classes to
// the existing nodeSel / linkSel. Removing this whole block restores the
// viewer to its prior behaviour.
// ───────────────────────────────────────────────────────────────────────────

// 1. Tag every link with its graphify-style confidence class so the CSS
//    (.link.confidence-EXTRACTED / -INFERRED / -AMBIGUOUS) can style it.
linkSel.each(function(d) {
  const md = (d && d.metadata) || {};
  const conf = md.confidence;
  if (conf) this.classList.add("confidence-" + conf);
});

// 2. Compute per-node lens flags from the existing data so the lens
//    buttons are instant (no fetch). These are stable for the session.
const _gapKindIn = new Set(["could_address","potentially_solves","solves"]);
const _solvedSet = new Set();
links.forEach(l => {
  if (_gapKindIn.has(l.kind)) {
    const tid = typeof l.target === "object" ? l.target.id : l.target;
    _solvedSet.add(tid);
  }
});
Object.values(nodesById).forEach(n => {
  n._isGap = (n.kind === "painpoint") && !_solvedSet.has(n.id);
  const sd = (n.metadata || {}).source_diversity || 0;
  n._isBridge = sd >= 3;
  n._communityId = (n.metadata || {}).community_id;
});

// 3. Community color overlay — a second outer ring per node, coloured by
//    community_id. Hidden until the "Communities" lens is on.
const communityColors = d3.scaleOrdinal(d3.schemeTableau10);
nodeSel.insert("circle", "circle")
  .attr("class", "community-ring")
  .attr("r", d => radiusOf(d) + 3.5)
  .attr("stroke", d => d._communityId != null
        ? communityColors(String(d._communityId)) : "transparent")
  .style("display", "none");

// 4. Confidence-filter cycler. Order: ALL → INFERRED only → EXTRACTED only
//    → AMBIGUOUS only → ALL …
const _confidenceStates = [null, "INFERRED", "EXTRACTED", "AMBIGUOUS"];
let _confidenceIdx = 0;
function applyConfidenceFilter() {
  const want = _confidenceStates[_confidenceIdx];
  const btn = document.getElementById("lensConfidence");
  if (want) btn.textContent = "⊕ " + want.toLowerCase();
  else btn.textContent = "⊕ All edges";
  btn.classList.toggle("active", want != null);
  linkSel.classed("dim", function(d) {
    if (!want) return false;
    const c = (d.metadata || {}).confidence;
    return c !== want;
  });
}

// 5. Lens state — at most one of surprising/gaps/bridges may be on. Search
//    works alongside any lens. Communities is independent of the rest.
const lensState = { surprising:false, gaps:false, bridges:false, communities:false };

function applyLenses() {
  const anyHighlight = lensState.surprising || lensState.gaps || lensState.bridges;

  // Reset transient classes
  linkSel.classed("surprising", false);
  nodeSel.classed("gap", false).classed("bridge", false);
  nodeSel.classed("dim", false);
  linkSel.classed("dim", false);

  // Surprising connections: cross-community + decent weight (≥0.45).
  // Also covers co_evidenced where weight is a shared-count integer.
  if (lensState.surprising) {
    linkSel.classed("surprising", d => {
      const s = typeof d.source === "object" ? d.source : nodesById[d.source];
      const t = typeof d.target === "object" ? d.target : nodesById[d.target];
      if (!s || !t) return false;
      const sc = s._communityId, tc = t._communityId;
      if (sc == null || tc == null || sc === tc) return false;
      const okKind = ["relates_to","co_evidenced","potentially_solves","could_address"].includes(d.kind);
      if (!okKind) return false;
      const w = +d.weight || 0;
      // relates_to uses cosine ∈ [0,1]; co_evidenced uses shared-post count.
      return d.kind === "co_evidenced" ? w >= 1 : w >= 0.45;
    });
  }

  // Knowledge gaps: painpoints with no solver. Highlight + dim rest.
  if (lensState.gaps) {
    nodeSel.classed("gap", d => !!d._isGap);
    nodeSel.classed("dim", d => !d._isGap);
    linkSel.classed("dim", true);
  }

  // Cross-source bridges: ≥3 source kinds on a finding. Highlight + dim rest.
  if (lensState.bridges) {
    nodeSel.classed("bridge", d => !!d._isBridge);
    nodeSel.classed("dim", d => !d._isBridge);
    linkSel.classed("dim", true);
  }

  // If only "surprising" is on, dim everything that's not a surprising edge
  // or an endpoint of one — so the lens reads cleanly.
  if (lensState.surprising && !lensState.gaps && !lensState.bridges) {
    const keepIds = new Set();
    linkSel.each(function(d) {
      if (this.classList.contains("surprising")) {
        const sid = typeof d.source === "object" ? d.source.id : d.source;
        const tid = typeof d.target === "object" ? d.target.id : d.target;
        keepIds.add(sid); keepIds.add(tid);
      }
    });
    nodeSel.classed("dim", d => !keepIds.has(d.id));
    linkSel.classed("dim", function(d) { return !this.classList.contains("surprising"); });
  }

  // Communities overlay is independent of the three highlight lenses.
  nodeSel.select("circle.community-ring")
    .style("display", lensState.communities ? null : "none");

  // Always re-apply confidence filter at the end so it composes correctly.
  applyConfidenceFilter();

  // Sync button visual state.
  ["surprising","gaps","bridges","communities"].forEach(k => {
    const btn = document.getElementById("lens" + k[0].toUpperCase() + k.slice(1));
    if (btn) btn.classList.toggle("active", !!lensState[k]);
  });
}

function bindLens(key) {
  const btn = document.getElementById("lens" + key[0].toUpperCase() + key.slice(1));
  if (!btn) return;
  btn.addEventListener("click", () => {
    // surprising/gaps/bridges are mutually exclusive — toggling one off
    // turns the others off too. Communities is independent.
    if (key === "communities") {
      lensState.communities = !lensState.communities;
    } else {
      const next = !lensState[key];
      lensState.surprising = lensState.gaps = lensState.bridges = false;
      lensState[key] = next;
    }
    applyLenses();
  });
}
bindLens("surprising");
bindLens("gaps");
bindLens("bridges");
bindLens("communities");

document.getElementById("lensConfidence").addEventListener("click", () => {
  _confidenceIdx = (_confidenceIdx + 1) % _confidenceStates.length;
  applyLenses();
});

// 6. Search — dims non-matching nodes (and their orphan edges) without
//    hiding so the layout stays stable. Empty string clears.
const searchEl = document.getElementById("graphSearch");
let _searchTimer = null;
searchEl.addEventListener("input", () => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    const q = searchEl.value.trim().toLowerCase();
    if (!q) {
      // Re-apply lenses (clears search-driven dims).
      applyLenses();
      return;
    }
    const matchIds = new Set();
    nodeSel.classed("dim", d => {
      const lbl = (d.label || "").toLowerCase();
      const hit = lbl.includes(q);
      if (hit) matchIds.add(d.id);
      return !hit;
    });
    linkSel.classed("dim", l => {
      const sid = typeof l.source === "object" ? l.source.id : l.source;
      const tid = typeof l.target === "object" ? l.target.id : l.target;
      return !(matchIds.has(sid) || matchIds.has(tid));
    });
  }, 120);
});

// 7. Append a confidence + community count line to the existing legend
//    so the new visual cues have a discoverable meaning.
(function augmentLegend() {
  const legendEl = document.getElementById("legend");
  if (!legendEl) return;
  const conf = (meta && meta.edge_confidence) || {};
  const sizes = (meta && meta.community_sizes) || {};
  const commCount = Object.keys(sizes).length;
  let extra = "";
  if (Object.keys(conf).length) {
    const parts = [];
    if (conf.EXTRACTED) parts.push(`<span title="Deterministic SQL join">— solid: ${conf.EXTRACTED}</span>`);
    if (conf.INFERRED)  parts.push(`<span title="LLM extraction or strong structural signal">- - - dashed: ${conf.INFERRED}</span>`);
    if (conf.AMBIGUOUS) parts.push(`<span title="Cosine-only similarity, no other signal">… dotted: ${conf.AMBIGUOUS}</span>`);
    extra += parts.join(" · ");
  }
  if (commCount) {
    if (extra) extra += " · ";
    extra += `<span title="Run 'graph communities' to populate">🎨 ${commCount} communities</span>`;
  }
  if (extra) {
    const div = document.createElement("div");
    div.style.cssText = "width:100%; margin-top:4px; font-size:10px; color:var(--muted);";
    div.innerHTML = extra;
    legendEl.appendChild(div);
  }
})();

applyLenses();  // sync initial state
</script>
</body>
</html>
"""


def export_graph_html(
    topic: str, out_path: Path | str, mode: str = "skeleton", max_post_nodes: int = 120
) -> str:
    """Write a self-contained, findings-first HTML viewer.

    Default `mode='skeleton'` renders only semantic nodes + top-N evidence
    posts (~100-300 nodes). Set `mode='full'` for all nodes (very slow at >3k).
    """
    data = export_graph_json(topic, mode=mode, max_post_nodes=max_post_nodes)
    payload = json.dumps(data, ensure_ascii=False, default=str).replace("</script>", "<\\/script>")
    html = _HTML_TEMPLATE.replace("{TOPIC}", topic.replace("<", "&lt;")).replace(
        "{GRAPH_JSON}", payload
    )
    p = Path(out_path)
    p.write_text(html, encoding="utf-8")
    return str(p)
