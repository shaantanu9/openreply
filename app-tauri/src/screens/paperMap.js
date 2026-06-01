// Paper Map — a relationship graph of a topic's academic papers.
//
// Connects papers four ways (computed server-side in
// research/paper_relations.py): semantic similarity (palace embeddings),
// citations (resolved references), shared findings (both back the same
// gap-map painpoint/feature), and shared author. Nodes are coloured by
// source, sized by citation count; edges coloured by relation kind with a
// togglable legend. Click a node to inspect the paper + open it.
//
// Self-contained: calls the `paper_map` Rust command directly (no api.js
// dependency) and renders a dependency-free SVG force layout computed with a
// small fixed-iteration simulation (deterministic — no per-frame animation).
import { invoke } from '@tauri-apps/api/core';

const $ = (sel, root = document) => root.querySelector(sel);

const SOURCE_COLOURS = {
  arxiv: '#B084CC', pubmed: '#C87070', openalex: '#5B8DB8',
  semantic_scholar: '#FF8C42', crossref: '#7BA88C', scholar: '#D4A574',
};
const KIND_COLOURS = {
  semantic: '#5B8DB8', cites: '#B084CC',
  'shared finding': '#7BA88C', 'same author': '#D4A574',
};
const KIND_ORDER = ['semantic', 'cites', 'shared finding', 'same author'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── deterministic force layout ───────────────────────────────────────────────
// O(n²) repulsion + edge springs + center gravity, run for a fixed number of
// iterations then frozen. Positions seeded on a circle by index so the result
// is stable across renders (no Math.random).
function layout(nodes, edges, { width, height, iterations = 280 } = {}) {
  const n = nodes.length;
  if (!n) return;
  const cx = width / 2, cy = height / 2;
  const R = Math.min(width, height) * 0.38;
  const idx = new Map();
  nodes.forEach((nd, i) => {
    const a = (i / n) * Math.PI * 2;
    nd.x = cx + R * Math.cos(a);
    nd.y = cy + R * Math.sin(a);
    nd.vx = 0; nd.vy = 0;
    idx.set(nd.id, i);
  });
  const links = edges
    .map(e => ({ s: idx.get(e.src), t: idx.get(e.dst), w: e.weight || 1 }))
    .filter(l => l.s != null && l.t != null);

  const kRep = 5200;       // repulsion strength
  const kSpring = 0.015;   // edge attraction
  const idealLen = Math.max(60, R / Math.sqrt(Math.max(n, 1)) * 2.4);
  const gravity = 0.012;

  for (let it = 0; it < iterations; it++) {
    // repulsion
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
        let d2 = dx * dx + dy * dy || 0.01;
        const f = kRep / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        nodes[i].vx += fx; nodes[i].vy += fy;
        nodes[j].vx -= fx; nodes[j].vy -= fy;
      }
    }
    // springs
    for (const l of links) {
      const a = nodes[l.s], b = nodes[l.t];
      let dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d - idealLen) * kSpring * (0.5 + l.w);
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    // gravity + integrate (damped)
    const damp = 0.85;
    for (const nd of nodes) {
      nd.vx += (cx - nd.x) * gravity;
      nd.vy += (cy - nd.y) * gravity;
      nd.x += nd.vx * 0.5; nd.y += nd.vy * 0.5;
      nd.vx *= damp; nd.vy *= damp;
      nd.x = Math.max(24, Math.min(width - 24, nd.x));
      nd.y = Math.max(24, Math.min(height - 24, nd.y));
    }
  }
}

function radiusFor(cites) {
  return 6 + Math.min(18, Math.sqrt(Math.max(0, cites)) * 1.6);
}

function renderSvg(data, { activeKinds }) {
  const W = 1100, H = 680;
  const nodes = data.nodes.map(nd => ({ ...nd }));
  const edges = data.edges.filter(e => activeKinds.has(e.kind));
  layout(nodes, edges, { width: W, height: H });
  const byId = new Map(nodes.map(nd => [nd.id, nd]));

  const lines = edges.map(e => {
    const a = byId.get(e.src), b = byId.get(e.dst);
    if (!a || !b) return '';
    const col = KIND_COLOURS[e.kind] || '#888';
    return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"
                  stroke="${col}" stroke-width="${(0.6 + (e.weight || 0.5) * 1.4).toFixed(2)}"
                  stroke-opacity="0.45" data-kind="${esc(e.kind)}" />`;
  }).join('');

  // Label only the most-cited handful to avoid clutter.
  const labelTop = new Set([...nodes].sort((a, b) => b.cites - a.cites).slice(0, 14).map(n => n.id));
  const circles = nodes.map(nd => {
    const col = SOURCE_COLOURS[nd.source] || '#999';
    const r = radiusFor(nd.cites);
    const label = labelTop.has(nd.id)
      ? `<text x="${(nd.x + r + 3).toFixed(1)}" y="${(nd.y + 4).toFixed(1)}" font-size="11" fill="var(--ink-2)">${esc((nd.label || '').slice(0, 36))}</text>`
      : '';
    return `<g class="pm-node" data-id="${esc(nd.id)}" style="cursor:pointer">
        <circle cx="${nd.x.toFixed(1)}" cy="${nd.y.toFixed(1)}" r="${r.toFixed(1)}"
                fill="${col}" fill-opacity="0.85" stroke="var(--bg)" stroke-width="1.5"/>
        ${label}
      </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:var(--surface);border:1px solid var(--line);border-radius:12px">
      <g class="pm-edges">${lines}</g>
      <g class="pm-nodes">${circles}</g>
    </svg>`;
}

function legendHtml(stats, activeKinds) {
  const by = stats?.by_kind || {};
  return KIND_ORDER.map(k => {
    const count = by[k] || 0;
    const on = activeKinds.has(k);
    return `<button class="pm-legend-item ${on ? '' : 'off'}" data-kind="${esc(k)}" type="button"
                    style="opacity:${on ? 1 : 0.4}">
        <span class="pm-swatch" style="background:${KIND_COLOURS[k]}"></span>
        ${esc(k)} <b>${count}</b>
      </button>`;
  }).join('');
}

export async function renderPaperMap(root, { params } = {}) {
  const topic = decodeURIComponent((params && params[0]) || '');
  const myGen = root.dataset.routeGen;
  const stillHere = () => root.dataset.routeGen === myGen && root.isConnected;

  if (!topic) {
    root.innerHTML = `
      <header class="topbar"><div class="crumbs"><a href="#/" style="color:var(--ink-3);text-decoration:none">Workspace</a> / <strong>Paper Map</strong></div></header>
      <div class="empty-state"><h3>Open a topic's Paper Map</h3>
        <p>From a topic's <b>Papers</b> tab, click <b>View map</b> — or open <code>#/paper-map/&lt;topic&gt;</code>.</p></div>`;
    return;
  }

  const activeKinds = new Set(KIND_ORDER);

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/" style="color:var(--ink-3);text-decoration:none">Workspace</a>
        / <a href="#/topic/${encodeURIComponent(topic)}" style="color:var(--ink-3);text-decoration:none">${esc(topic)}</a>
        / <strong>Paper Map</strong>
      </div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-sm btn-bordered" id="pm-rebuild"><i data-lucide="refresh-cw"></i> Rebuild</button>
    </header>
    <div class="pm-wrap" style="padding:16px;display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:start">
      <div>
        <div class="pm-legend" id="pm-legend" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px"></div>
        <div id="pm-canvas"><div class="empty-state"><h3>Building the map…</h3><p>Computing semantic, citation, shared-finding and author links for "${esc(topic)}".</p></div></div>
      </div>
      <aside class="pm-side" id="pm-side" style="background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px;font-size:13px;color:var(--ink-2)">
        <b>Paper Map</b>
        <p class="muted" style="font-size:12px;margin-top:6px">Click a node to inspect a paper. Toggle relation types in the legend.</p>
        <div id="pm-detail"></div>
      </aside>
    </div>`;
  window.refreshIcons?.();

  let data = null;
  const canvas = $('#pm-canvas', root);
  const legend = $('#pm-legend', root);

  const paint = () => {
    if (!data || !stillHere()) return;
    if (!data.ok) { canvas.innerHTML = `<div class="empty-state"><h3>Couldn't build map</h3><p>${esc(data.reason || 'unknown error')}</p></div>`; return; }
    if (!data.nodes.length) {
      canvas.innerHTML = `<div class="empty-state"><h3>No papers yet for "${esc(topic)}"</h3><p>${esc(data.stats?.reason || 'Collect academic papers first (open the topic → Papers → Find papers).')}</p></div>`;
      legend.innerHTML = '';
      return;
    }
    legend.innerHTML = legendHtml(data.stats, activeKinds);
    canvas.innerHTML = renderSvg(data, { activeKinds });
    wireInteractions();
    window.refreshIcons?.();
  };

  const wireInteractions = () => {
    legend.querySelectorAll('.pm-legend-item').forEach(b => {
      b.addEventListener('click', () => {
        const k = b.dataset.kind;
        if (activeKinds.has(k)) activeKinds.delete(k); else activeKinds.add(k);
        paint();
      });
    });
    canvas.querySelectorAll('.pm-node').forEach(g => {
      g.addEventListener('click', () => {
        const nd = data.nodes.find(x => x.id === g.dataset.id);
        if (nd) showDetail(nd);
      });
    });
  };

  const showDetail = (nd) => {
    const detail = $('#pm-detail', root);
    if (!detail) return;
    detail.innerHTML = `
      <hr style="border:none;border-top:1px solid var(--line);margin:12px 0">
      <div style="font-weight:600;color:var(--ink);line-height:1.4">${esc(nd.label)}</div>
      <div class="muted" style="font-size:12px;margin:6px 0">
        ${esc(nd.source || '—')} · ${nd.year || '—'} · ${Number(nd.cites || 0).toLocaleString()} cites${nd.has_fulltext ? ' · full text' : ''}
      </div>
      ${nd.author ? `<div class="muted" style="font-size:12px">${esc(nd.author)}</div>` : ''}
      <a class="btn btn-sm btn-bordered" style="margin-top:10px" href="https://openalex.org/works?search=${encodeURIComponent(nd.label)}" target="_blank" rel="noopener"><i data-lucide="external-link"></i> Look up</a>`;
    window.refreshIcons?.();
  };

  const load = async (rebuild = false) => {
    if (rebuild) canvas.innerHTML = `<div class="empty-state"><h3>Rebuilding…</h3><p>Recomputing semantic neighbours (this re-runs embeddings).</p></div>`;
    try {
      const r = await invoke('paper_map', { topic, rebuild });
      if (!stillHere()) return;
      data = r;
      paint();
    } catch (e) {
      if (stillHere()) canvas.innerHTML = `<div class="empty-state"><h3>Map failed to load</h3><p>${esc(e?.message || e)}</p></div>`;
    }
  };

  $('#pm-rebuild', root)?.addEventListener('click', () => load(true));
  load(false);
}
