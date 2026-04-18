"""Graph exporters — JSON (generic) and self-contained HTML (D3 force-graph).

The HTML is a single file: paste, double-click, it opens in any browser.
Data is embedded inline; D3 loaded from CDN. Interactive: pan/zoom, click
for details, filter by kind + era.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..core.db import get_db
from .query import _parse_metadata


def export_graph_json(topic: str) -> dict[str, Any]:
    """Return a D3 force-graph shaped dict: {nodes, links, meta}."""
    db = get_db()
    node_rows = list(db.query("SELECT * FROM graph_nodes WHERE topic = ?", [topic]))
    edge_rows = list(db.query("SELECT * FROM graph_edges WHERE topic = ?", [topic]))

    nodes = []
    for r in node_rows:
        parsed = _parse_metadata(r)
        nodes.append(
            {
                "id": parsed["id"],
                "kind": parsed["kind"],
                "label": parsed["label"],
                "metadata": parsed.get("metadata", {}),
            }
        )

    links = [
        {
            "source": r["src"],
            "target": r["dst"],
            "kind": r["kind"],
            "weight": r.get("weight") or 1.0,
        }
        for r in edge_rows
    ]

    kinds_count: dict[str, int] = {}
    for n in nodes:
        kinds_count[n["kind"]] = kinds_count.get(n["kind"], 0) + 1

    return {
        "meta": {
            "topic": topic,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "total_nodes": len(nodes),
            "total_edges": len(links),
            "nodes_by_kind": kinds_count,
        },
        "nodes": nodes,
        "links": links,
    }


_HTML_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Gap Map — {TOPIC}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --bg: #0e1116;
    --panel: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: #58a6ff;
  }
  html, body {
    margin: 0; padding: 0; height: 100%; width: 100%;
    background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif;
    overflow: hidden;
  }
  header {
    padding: 10px 16px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
    background: var(--panel);
  }
  h1 { font-size: 15px; margin: 0; font-weight: 600; }
  .meta { font-size: 12px; color: var(--muted); }
  main {
    position: fixed; top: 44px; left: 0; right: 0; bottom: 0;
    display: grid; grid-template-columns: 200px 1fr 280px;
  }
  aside {
    overflow-y: auto; padding: 12px 14px;
    border-right: 1px solid var(--border); background: var(--panel);
    font-size: 13px;
  }
  aside.right { border-right: none; border-left: 1px solid var(--border); }
  aside h3 {
    font-size: 11px; font-weight: 600; color: var(--muted);
    text-transform: uppercase; letter-spacing: .5px;
    margin: 8px 0 4px; padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  aside h3:first-child { border-top: none; padding-top: 0; }
  label { display: block; padding: 3px 0; cursor: pointer; user-select: none; }
  label input { margin-right: 6px; vertical-align: middle; }
  .swatch {
    display: inline-block; width: 10px; height: 10px; border-radius: 50%;
    margin-right: 6px; vertical-align: middle;
  }
  #graph { width: 100%; height: 100%; background: var(--bg); }
  .node { cursor: pointer; }
  .node:hover circle { stroke: #fff; stroke-width: 2px; }
  .link { stroke-opacity: 0.35; }
  .details pre {
    white-space: pre-wrap; word-break: break-word; font-size: 11px;
    color: var(--muted); max-height: 320px; overflow-y: auto;
    background: var(--bg); padding: 8px; border-radius: 4px;
    border: 1px solid var(--border);
  }
  .details a { color: var(--accent); word-break: break-all; }
  .count { color: var(--muted); font-size: 11px; margin-left: 4px; }
  footer {
    position: fixed; bottom: 6px; right: 12px;
    font-size: 10px; color: var(--muted);
  }
</style>
</head>
<body>
<header>
  <h1>Gap Map — {TOPIC}</h1>
  <div class="meta" id="metaLine"></div>
</header>
<main>
  <aside class="left">
    <h3>Filter · Kind</h3>
    <div id="kindFilters"></div>
    <h3>Filter · Era</h3>
    <label><input type="radio" name="era" value="all" checked> All</label>
    <label><input type="radio" name="era" value="pre_2025"> Pre-May-2025</label>
    <label><input type="radio" name="era" value="post_2025"> Post-May-2025</label>
    <h3>Controls</h3>
    <label><input type="checkbox" id="showLabels"> Show labels on hover only</label>
    <button id="resetZoom" style="margin-top:8px;padding:4px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:12px;">Reset zoom</button>
  </aside>
  <svg id="graph"></svg>
  <aside class="right">
    <h3>Selected node</h3>
    <div class="details" id="details"><em style="color:var(--muted)">Click a node to inspect.</em></div>
  </aside>
</main>
<footer>generated with <a href="#" style="color:var(--muted)">reddit-myind</a></footer>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const DATA = {GRAPH_JSON};

// --- color palette per kind
const KIND_COLORS = {
  topic: "#f778ba", subreddit: "#a371f7", post: "#58a6ff",
  comment: "#79c0ff", user: "#3fb950", era: "#7d8590",
  painpoint: "#f85149", feature_wish: "#ffa657",
  product: "#d2a8ff", workaround: "#7ee787", keyword: "#ff9e40",
};
const KIND_LABEL = {
  topic: "Topic", subreddit: "Subreddit", post: "Post", comment: "Comment",
  user: "User", era: "Era", painpoint: "Painpoint",
  feature_wish: "Feature wish", product: "Product", workaround: "DIY workaround",
  keyword: "Keyword",
};

document.getElementById("metaLine").textContent =
  `${DATA.meta.total_nodes} nodes · ${DATA.meta.total_edges} edges · ${DATA.meta.generated_at.replace('T',' ').split('+')[0]} UTC`;

// Build kind filter checkboxes
const kindCounts = DATA.meta.nodes_by_kind;
const kindsWrap = document.getElementById("kindFilters");
const kindState = {};
Object.keys(kindCounts).sort().forEach(k => {
  kindState[k] = true;
  const lbl = document.createElement("label");
  lbl.innerHTML = `<input type="checkbox" data-kind="${k}" checked>
    <span class="swatch" style="background:${KIND_COLORS[k]||'#888'}"></span>
    ${KIND_LABEL[k]||k}<span class="count">${kindCounts[k]}</span>`;
  kindsWrap.appendChild(lbl);
});

// --- force graph
const svg = d3.select("#graph");
const width = svg.node().clientWidth;
const height = svg.node().clientHeight;

const g = svg.append("g");

// zoom / pan
const zoom = d3.zoom().scaleExtent([0.1, 8]).on("zoom", e => g.attr("transform", e.transform));
svg.call(zoom);
document.getElementById("resetZoom").onclick = () =>
  svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);

const nodesById = Object.fromEntries(DATA.nodes.map(n => [n.id, {...n}]));
const links = DATA.links.map(l => ({ ...l, source: l.source, target: l.target }));

const sim = d3.forceSimulation(Object.values(nodesById))
  .force("link", d3.forceLink(links).id(d => d.id).distance(40).strength(0.4))
  .force("charge", d3.forceManyBody().strength(-80))
  .force("center", d3.forceCenter(width/2, height/2))
  .force("collide", d3.forceCollide(8));

const linkSel = g.append("g").attr("stroke","#6e7681")
  .selectAll("line").data(links).join("line")
  .attr("class","link").attr("stroke-width", d => Math.max(0.5, (d.weight||1)*0.5));

const nodeSel = g.append("g").selectAll("g")
  .data(Object.values(nodesById)).join("g").attr("class","node");

nodeSel.append("circle")
  .attr("r", d => d.kind === "topic" ? 14 : d.kind === "subreddit" ? 9 :
                  d.kind === "painpoint" || d.kind === "product" || d.kind === "workaround" || d.kind === "feature_wish" ? 8 :
                  d.kind === "era" ? 11 : d.kind === "user" ? 4 : 5)
  .attr("fill", d => KIND_COLORS[d.kind] || "#888")
  .attr("stroke", "#161b22").attr("stroke-width", 1);

nodeSel.append("title").text(d => `${d.label}  [${d.kind}]`);

nodeSel.append("text")
  .attr("x", 10).attr("y", 3)
  .style("font-size","10px").style("fill","#c9d1d9")
  .style("pointer-events","none")
  .text(d => (["topic","subreddit","era","painpoint","product","workaround","feature_wish"].includes(d.kind)) ? d.label.slice(0,36) : "");

const details = document.getElementById("details");
nodeSel.on("click", (e, d) => {
  const md = d.metadata || {};
  let html = `<div><strong>${d.label}</strong></div>
    <div style="color:var(--muted);font-size:12px">${KIND_LABEL[d.kind] || d.kind}</div>
    <h3>Metadata</h3>
    <pre>${escapeHtml(JSON.stringify(md, null, 2))}</pre>`;
  if (md.permalink) html += `<div><a href="${md.permalink}" target="_blank">Open on Reddit ↗</a></div>`;
  details.innerHTML = html;
});

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\\"":"&quot;"}[c]));
}

nodeSel.call(d3.drag()
  .on("start", (e,d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
  .on("drag", (e,d) => { d.fx=e.x; d.fy=e.y; })
  .on("end", (e,d) => { if (!e.active) sim.alphaTarget(0); d.fx=null; d.fy=null; }));

sim.on("tick", () => {
  linkSel.attr("x1", d=>d.source.x).attr("y1", d=>d.source.y)
         .attr("x2", d=>d.target.x).attr("y2", d=>d.target.y);
  nodeSel.attr("transform", d => `translate(${d.x},${d.y})`);
});

// --- filters
function applyFilters() {
  const era = document.querySelector('input[name="era"]:checked').value;
  nodeSel.style("display", d => {
    if (!kindState[d.kind]) return "none";
    if (era !== "all" && d.kind !== "era" && d.kind !== "topic" && d.kind !== "subreddit" && d.kind !== "user") {
      const dEra = (d.metadata||{}).era;
      if (dEra && dEra !== era) return "none";
    }
    return null;
  });
  linkSel.style("display", d => {
    const s = nodesById[d.source.id||d.source], t = nodesById[d.target.id||d.target];
    if (!kindState[s.kind] || !kindState[t.kind]) return "none";
    return null;
  });
}
document.querySelectorAll('#kindFilters input, input[name="era"]').forEach(cb =>
  cb.addEventListener("change", e => {
    if (e.target.dataset.kind) kindState[e.target.dataset.kind] = e.target.checked;
    applyFilters();
  })
);
</script>
</body>
</html>
"""


def export_graph_html(topic: str, out_path: Path | str) -> str:
    """Write a self-contained interactive HTML viewer for a topic's graph."""
    data = export_graph_json(topic)
    # Safe embedding — escape </script> if present inside any label/body
    payload = json.dumps(data, ensure_ascii=False, default=str).replace("</script>", "<\\/script>")
    html = _HTML_TEMPLATE.replace("{TOPIC}", topic.replace("<", "&lt;")).replace(
        "{GRAPH_JSON}", payload
    )
    p = Path(out_path)
    p.write_text(html, encoding="utf-8")
    return str(p)
