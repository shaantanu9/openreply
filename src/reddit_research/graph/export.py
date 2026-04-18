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


def _findings_for_topic(topic: str) -> dict[str, list[dict]]:
    """Pull ranked findings per kind with their evidence edge counts."""
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
                          AND e.kind IN ('evidenced_by','wished_in','about_product','built_in','solves'))
                        AS evidence_count
                FROM graph_nodes n
                WHERE n.topic = ? AND n.kind = ?
                ORDER BY evidence_count DESC
                """,
                [topic, kind],
            )
        )
        parsed = [_parse_metadata(r) for r in rows]
        # attach evidence count separately since _parse_metadata strips it
        for p, r in zip(parsed, rows, strict=False):
            p["evidence_count"] = r.get("evidence_count", 0)
        out[kind] = parsed
    return out


SKELETON_KINDS = {
    "topic", "era", "subreddit", "source",
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

    nodes_out = []
    for nid in keep_ids:
        if nid not in all_nodes:
            continue
        p = all_nodes[nid]
        nodes_out.append({
            "id": p["id"], "kind": p["kind"], "label": p["label"],
            "metadata": p.get("metadata", {}),
        })

    links_out = [
        {"source": r["src"], "target": r["dst"], "kind": r["kind"], "weight": r.get("weight") or 1.0}
        for r in all_edges
        if r["src"] in keep_ids and r["dst"] in keep_ids
    ]

    kinds_count: dict[str, int] = {}
    for n in nodes_out:
        kinds_count[n["kind"]] = kinds_count.get(n["kind"], 0) + 1

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
    --bg:#0b0e13; --panel:#141921; --border:#2a3340; --text:#e6edf3; --muted:#8b949e;
    --accent:#58a6ff; --chronic:#f85149; --emerging:#ffa657; --fading:#8b949e;
  }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; height:100%; width:100%; background:var(--bg);
    color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",sans-serif;
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
  aside h2 { font-size:11px; font-weight:700; color:var(--text); margin:14px 0 6px;
    text-transform:uppercase; letter-spacing:.6px; }
  aside h2:first-child { margin-top:0; }

  .card { background:var(--bg); border:1px solid var(--border); border-radius:5px;
    padding:8px 10px; margin-bottom:6px; cursor:pointer; transition:border-color .15s; }
  .card:hover { border-color:var(--accent); }
  .card.active { border-color:var(--accent); background:#0f1720; }
  .card-title { font-size:12px; font-weight:600; line-height:1.35; }
  .card-meta { font-size:10px; color:var(--muted); margin-top:3px; display:flex; gap:8px;
    flex-wrap:wrap; }
  .badge { display:inline-block; padding:1px 6px; border-radius:3px; font-size:9px; font-weight:700;
    letter-spacing:.3px; }
  .badge.chronic { background:var(--chronic); color:white; }
  .badge.emerging { background:var(--emerging); color:black; }
  .badge.fading { background:var(--fading); color:white; }
  .badge.severity-high { background:#3d1216; color:#ff6b6b; border:1px solid #5a1a20; }
  .badge.severity-medium { background:#3d2a12; color:#ffa657; border:1px solid #5a401a; }
  .badge.severity-low { background:#1a3512; color:#7ee787; border:1px solid #2a5020; }
  .card-evidence { font-size:11px; color:var(--muted); margin-top:4px; font-style:italic;
    border-top:1px solid var(--border); padding-top:4px; }

  .legend { display:flex; flex-wrap:wrap; gap:8px; font-size:10px; color:var(--muted);
    padding:6px 8px; background:var(--bg); border-radius:4px; border:1px solid var(--border);
    margin-bottom:10px; }
  .swatch { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:3px;
    vertical-align:middle; }

  #graph { width:100%; height:100%; background:var(--bg); }
  .node { cursor:pointer; }
  .node circle { transition:stroke-width .15s; }
  .node.highlighted circle { stroke:#fff; stroke-width:3px; }
  .node.dimmed { opacity:0.15; }
  .link { stroke-opacity:0.25; }
  .link.highlighted { stroke:var(--accent); stroke-opacity:0.9; stroke-width:1.5px; }

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

  .controls { display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap; }
  .controls button, .controls label { background:var(--bg); color:var(--text);
    border:1px solid var(--border); border-radius:3px; padding:3px 8px; cursor:pointer;
    font-size:11px; user-select:none; }
  .controls input { margin-right:4px; vertical-align:middle; }

  .empty { color:var(--muted); font-size:11px; font-style:italic; padding:4px; }

  footer { position:fixed; bottom:4px; right:10px; font-size:9px; color:var(--muted); }
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
    <div class="legend" id="legend"></div>

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
    <div id="details" class="details">
      <p class="empty">Click any finding on the left — the graph zooms to its evidence and this panel shows the posts.</p>
    </div>
  </aside>
</main>
<footer>reddit-myind · gap map</footer>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const DATA = {GRAPH_JSON};

const KIND_COLORS = {
  topic:"#f778ba", subreddit:"#a371f7", post:"#58a6ff", comment:"#79c0ff",
  user:"#3fb950", era:"#7d8590",
  painpoint:"#f85149", feature_wish:"#ffa657",
  product:"#d2a8ff", workaround:"#7ee787",
};
const KIND_LABEL = {
  topic:"Topic", subreddit:"Subreddit", post:"Post", comment:"Comment",
  user:"User", era:"Era", painpoint:"Painpoint", feature_wish:"Feature wish",
  product:"Product", workaround:"DIY workaround",
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
function renderFinding(node, onclick) {
  const md = node.metadata || {};
  const title = (node.label || "(unnamed)").replace(/</g,"&lt;");
  const classification = md.classification;
  const severity = md.severity;
  const freq = md.frequency;
  const evCount = node.evidence_count || 0;
  let badges = "";
  if (classification && classification !== "UNCLASSIFIED")
    badges += `<span class="badge ${classification.toLowerCase()}">${classification}</span>`;
  if (severity) badges += `<span class="badge severity-${severity}">${severity} sev</span>`;

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
  `;
  card.addEventListener("click", () => onclick(node));
  return card;
}

const findingsPanels = {
  painpoints: DATA.findings.painpoint || [],
  workarounds: DATA.findings.workaround || [],
  products: DATA.findings.product || [],
  features: DATA.findings.feature_wish || [],
};

document.getElementById("ppCount").textContent = `(${findingsPanels.painpoints.length})`;

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

const linkSel = g.append("g").attr("stroke","#48505c")
  .selectAll("line").data(links).join("line").attr("class","link");

const nodeSel = g.append("g").selectAll("g")
  .data(Object.values(nodesById)).join("g").attr("class","node");
nodeSel.append("circle")
  .attr("r", radiusOf)
  .attr("fill", d => KIND_COLORS[d.kind] || "#888")
  .attr("stroke", "#0b0e13").attr("stroke-width", 1.2);

nodeSel.append("title").text(d => `${d.label}  [${d.kind}]`);
nodeSel.append("text")
  .attr("x", d => radiusOf(d) + 3).attr("y", 3)
  .style("font-size","10px").style("fill","#c9d1d9").style("pointer-events","none")
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
function showNodeDetails(node) {
  const md = node.metadata || {};
  const host = document.getElementById("details");
  const title = (node.label || "").replace(/</g,"&lt;");
  let html = `<div><span class="kind-pill">${KIND_LABEL[node.kind]||node.kind}</span></div>
    <h3 style="margin-top:8px">${title}</h3>`;

  // Evidence posts (for semantic nodes)
  if (["painpoint","product","workaround","feature_wish"].includes(node.kind)) {
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
      html += `<div class="evidence-list"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">📎 ${posts.length} evidence posts</div>`;
      posts.forEach(p => {
        const pmd = p.metadata || {};
        const score = pmd.score != null ? `${pmd.score}↑` : "";
        const comments = pmd.num_comments != null ? `${pmd.num_comments}💬` : "";
        html += `<a href="${pmd.permalink||'#'}" target="_blank" rel="noopener">
          <div>${(p.label||'').replace(/</g,'&lt;')}</div>
          <div class="ev-meta">r/${(pmd.sub||'?')} · ${score} ${comments}</div>
        </a>`;
      });
      html += `</div>`;
    }
  }
  html += `<h3 style="font-size:11px;margin-top:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px">Metadata</h3>`;
  html += `<pre>${JSON.stringify(md, null, 2).replace(/</g,"&lt;")}</pre>`;
  if (md.permalink) html += `<div style="margin-top:8px"><a href="${md.permalink}" target="_blank" style="color:var(--accent)">Open on Reddit ↗</a></div>`;
  host.innerHTML = html;
}
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
