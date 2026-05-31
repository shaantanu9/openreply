// PRD Generator screen — Phase 6.2 of the discovery framework.
//
// Renders the markdown produced by research/prd.py: problem, JTBD,
// opportunities, Four Risks, value curve, TAM/SAM/SOM, Porter's Five
// Forces, positioning, PERT estimates, cost model, PMF/NPS/VW/MaxDiff,
// and out-of-scope list. Lets the user copy, download, or open the
// raw text in a new tab.
//
// Route: #/prd/<productId>
import { api, esc } from '../api.js';
import { renderAnalyzingState } from '../lib/analyzingLoader.js';

const $ = (sel, root = document) => root.querySelector(sel);

// Domain stages for the single blocking PRD build (api.prdExport aggregates
// every discovery artefact, then the LLM drafts the full PRD markdown). The
// payload lands at once — hero-only loader, no per-card polling.
const PRD_STAGES = [
  'Aggregating discovery artefacts…',
  'Reading JTBD, opportunities & Four Risks…',
  'Folding in TAM/SAM/SOM & pricing models…',
  'Drafting the PRD narrative…',
  'Structuring sections & PERT estimates…',
  'Almost done — formatting markdown…',
];

function productIdFromHash() {
  const m = (location.hash || '').match(/^#\/prd\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// Tiny markdown→HTML for preview (headings, bold, italic, lists,
// blockquotes, code). Not a full parser — intentionally minimal.
function mdToHtml(md) {
  const lines = (md || '').split(/\r?\n/);
  let html = '';
  let inList = false;
  let inQuote = false;
  let inCode = false;
  for (const raw of lines) {
    const line = raw;
    if (line.trim().startsWith('```')) {
      if (inCode) { html += '</code></pre>'; inCode = false; }
      else        { html += '<pre><code>'; inCode = true; }
      continue;
    }
    if (inCode) { html += esc(line) + '\n'; continue; }

    if (/^#{1,4} /.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      if (inQuote) { html += '</blockquote>'; inQuote = false; }
      const level = line.match(/^#+/)[0].length;
      html += `<h${level}>${inline(line.replace(/^#+ /, ''))}</h${level}>`;
      continue;
    }
    if (/^\s*- /.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(line.replace(/^\s*- /, ''))}</li>`;
      continue;
    }
    if (/^>/.test(line)) {
      if (!inQuote) { html += '<blockquote>'; inQuote = true; }
      html += `<p>${inline(line.replace(/^>\s?/, ''))}</p>`;
      continue;
    }
    if (line.trim() === '') {
      if (inList)  { html += '</ul>';        inList  = false; }
      if (inQuote) { html += '</blockquote>'; inQuote = false; }
      continue;
    }
    if (inList)  { html += '</ul>';        inList  = false; }
    if (inQuote) { html += '</blockquote>'; inQuote = false; }
    html += `<p>${inline(line)}</p>`;
  }
  if (inList)  html += '</ul>';
  if (inQuote) html += '</blockquote>';
  if (inCode)  html += '</code></pre>';
  return html;
}

function inline(s) {
  let out = esc(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  return out;
}

export async function renderPrd(root, { params }) {
  // routeGen guard — JS analog of Flutter context.mounted
  const myGen = root.dataset.routeGen;
  const alive = () => root.dataset.routeGen === myGen && root.isConnected;
  const id = decodeURIComponent(params?.[0] || '');
  if (!id) {
    root.innerHTML = `<div class="empty-big"><h3>No product ID</h3></div>`;
    return;
  }

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/products">Products</a> ›
        <a href="#/product/${esc(encodeURIComponent(id))}">${esc(id)}</a> ›
        <strong>PRD</strong>
      </div>
      <div class="topbar-actions">
        <button class="btn icon-btn" id="prd-copy"><i data-lucide="clipboard"></i> Copy markdown</button>
        <button class="btn icon-btn" id="prd-download"><i data-lucide="download"></i> Download .md</button>
        <button class="btn icon-btn" id="prd-refresh"><i data-lucide="refresh-cw"></i> Regenerate</button>
      </div>
    </header>
    <div class="prd-wrap">
      <div class="empty-state">Building PRD…</div>
    </div>
  `;
  window.refreshIcons?.();

  const wrap = $('.prd-wrap', root);

  const build = async () => {
    // Full-bleed alive loader while the blocking PRD build runs (5+ s — the
    // sidecar aggregates every artefact then the LLM drafts the markdown).
    const stop = renderAnalyzingState(wrap, {
      headline: 'Building PRD', stages: PRD_STAGES,
      medianRuntimeSec: 40, etaText: 'typically 20–60 seconds', skeletonCount: 3,
    });
    let result;
    try {
      result = await api.prdExport(id);
      if (!alive()) return;
    } catch (e) {
      if (!alive()) return;
      stop();
      wrap.innerHTML = `<div class="empty-big"><h3>Couldn't build PRD</h3><p>${esc(e?.message || e)}</p></div>`;
      return;
    }
    if (!result?.ok) {
      stop();
      wrap.innerHTML = `<div class="empty-big"><h3>${esc(result?.error || 'PRD failed')}</h3></div>`;
      return;
    }
    stop({ snapToComplete: true });
    const md = result.markdown || '';
    wrap.innerHTML = `
      <section class="prd-meta card">
        <div><strong>Generated PRD</strong> · ${md.length.toLocaleString()} chars</div>
        <p class="muted" style="font-size:11.5px">
          Aggregated from every discovery artefact: outcome, JTBD,
          opportunities + RICE/Kano/MoSCoW, Four Risks, Value Curve,
          TAM/SAM/SOM, Porter's Five Forces, positioning, empathy maps,
          interviews, PMF, NPS, Van Westendorp, MaxDiff, PERT, cost.
        </p>
      </section>

      <section class="prd-tabs">
        <button class="prd-tab is-active" data-tab="preview">Preview</button>
        <button class="prd-tab" data-tab="raw">Raw markdown</button>
      </section>

      <section class="prd-pane prd-preview" data-pane="preview">
        ${mdToHtml(md)}
      </section>
      <section class="prd-pane prd-raw" data-pane="raw" hidden>
        <textarea readonly class="prd-textarea">${esc(md)}</textarea>
      </section>
    `;
    window.refreshIcons?.();

    wrap.querySelectorAll('.prd-tab').forEach(t => t.addEventListener('click', () => {
      wrap.querySelectorAll('.prd-tab').forEach(x => x.classList.toggle('is-active', x === t));
      wrap.querySelectorAll('.prd-pane').forEach(p => p.hidden = p.dataset.pane !== t.dataset.tab);
    }));

    $('#prd-copy', root).onclick = async () => {
      try {
        await navigator.clipboard.writeText(md);
        if (!alive()) return;
        const btn = $('#prd-copy', root);
        btn.innerHTML = '<i data-lucide="check"></i> Copied';
        window.refreshIcons?.();
        setTimeout(() => {
          btn.innerHTML = '<i data-lucide="clipboard"></i> Copy markdown';
          window.refreshIcons?.();
        }, 1500);
      } catch (e) {
        alert(`Copy failed: ${e?.message || e}`);
      }
    };

    $('#prd-download', root).onclick = () => {
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prd-${id}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };
  };

  $('#prd-refresh', root).onclick = build;
  await build();
}
