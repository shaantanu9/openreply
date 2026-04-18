// Topic detail — tabs: Map / Report / Evidence / Actions.
// Embeds the existing gap-map.html viewer in Map tab.
// Renders the report-pro.md in Report tab.
// Shows painpoints + evidence in Evidence tab.

import { api, $, esc } from '../api.js';
import { convertFileSrc } from '@tauri-apps/api/core';

let activeTab = 'map';

export async function renderTopic(root, { params }) {
  const topic = decodeURIComponent(params[0] || '');

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/" style="color:var(--ink-3);text-decoration:none">Workspace</a> /
        <strong>${esc(topic)}</strong>
      </div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-ghost" id="btn-rerun" style="border:1px solid var(--line)">Rerun collect</button>
      <button class="btn btn-ghost" id="btn-delete" style="border:1px solid var(--line);color:#B84747">Delete</button>
    </header>

    <div class="section-head">
      <div><h2>${esc(topic)}</h2><p id="topic-sub">Loading…</p></div>
    </div>

    <div class="tabs" id="topic-tabs">
      <button class="tab active" data-tab="map">🕸 Map</button>
      <button class="tab" data-tab="report">📄 Report</button>
      <button class="tab" data-tab="evidence">🔎 Evidence</button>
      <button class="tab" data-tab="actions">⚡ Actions</button>
    </div>

    <div id="tab-content"><div class="empty-state">loading…</div></div>
  `;

  const tabsEl = $('#topic-tabs');
  const contentEl = $('#tab-content');

  async function loadMap() {
    contentEl.innerHTML = `<div class="empty-state">Building gap map…</div>`;
    try {
      await api.buildGraph(topic).catch(() => {});
      const outPath = await api.exportHtml(topic);
      const fileUrl = convertFileSrc(outPath);
      $('#topic-sub').textContent = outPath;
      contentEl.innerHTML = `<iframe class="viewer-frame" src="${fileUrl}" sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"></iframe>`;
    } catch (e) {
      contentEl.innerHTML = `
        <div class="empty-big">
          <h3>Couldn't render the gap map</h3>
          <p>${esc(e?.message || e)}</p>
          <button class="btn btn-primary" onclick="location.hash='#/collect/${encodeURIComponent(topic)}'">
            Run collect
          </button>
        </div>`;
    }
  }

  async function loadReport() {
    contentEl.innerHTML = `<div class="empty-state">Generating report…</div>`;
    try {
      const path = await api.exportReportPro(topic);
      $('#topic-sub').textContent = path;
      // Fetch file contents via fetch on the converted file URL
      const fileUrl = convertFileSrc(path);
      const resp = await fetch(fileUrl);
      const md = await resp.text();
      contentEl.innerHTML = `
        <div style="display:flex;gap:10px;margin-bottom:14px">
          <button class="btn btn-ghost" style="border:1px solid var(--line)" id="btn-copy-md">📋 Copy markdown</button>
          <button class="btn btn-ghost" style="border:1px solid var(--line)" id="btn-reveal-md">Reveal in Finder</button>
        </div>
        <div class="markdown-view">${renderMarkdown(md)}</div>
      `;
      $('#btn-copy-md').onclick = () => {
        navigator.clipboard.writeText(md);
        $('#btn-copy-md').textContent = '✓ Copied';
        setTimeout(() => { $('#btn-copy-md').textContent = '📋 Copy markdown'; }, 1500);
      };
      $('#btn-reveal-md').onclick = () => api.revealInFinder(path);
    } catch (e) {
      contentEl.innerHTML = `<div class="empty-state">Error: ${esc(e?.message || e)}</div>`;
    }
  }

  async function loadEvidence() {
    contentEl.innerHTML = `<div class="empty-state">Loading painpoints + evidence…</div>`;
    try {
      const [painpoints, features, products, workarounds] = await Promise.all([
        api.getFindings(topic, 'painpoint'),
        api.getFindings(topic, 'feature_wish'),
        api.getFindings(topic, 'product'),
        api.getFindings(topic, 'workaround'),
      ]);
      const section = (label, items, cls) => {
        if (!Array.isArray(items) || !items.length) return '';
        return `
          <div class="card" style="margin-bottom:14px">
            <div class="card-head"><div><h3>${esc(label)}</h3><p>${items.length} items</p></div></div>
            <div class="findings-rail">
              ${items.map((it, i) => `
                <div class="finding">
                  <div class="finding-bullet ${cls}">${i + 1}</div>
                  <div class="finding-body">
                    <h4>${esc(it.label || '')}</h4>
                    <div class="finding-meta">
                      ${it.evidence_count ? `<span>📎 ${it.evidence_count} evidence</span>` : ''}
                      ${it.metadata_json ? renderMetaPills(it.metadata_json) : ''}
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      };
      const html = [
        section('🔥 Painpoints', painpoints, 'chronic'),
        section('🛠 DIY workarounds', workarounds, 'emerging'),
        section('😡 Products complained about', products, 'chronic'),
        section('💡 Feature wishes', features, 'emerging'),
      ].filter(Boolean).join('');
      contentEl.innerHTML = html || `
        <div class="empty-big">
          <h3>No semantic extraction yet</h3>
          <p>Open the map or run enrichment to extract painpoints / products / DIY workarounds.</p>
        </div>`;
    } catch (e) {
      contentEl.innerHTML = `<div class="empty-state">Error: ${esc(e?.message || e)}</div>`;
    }
  }

  function loadActions() {
    contentEl.innerHTML = `
      <div class="settings-grid">
        <div class="settings-card">
          <h4>Re-run collect</h4>
          <p>Pull fresh data. Existing posts are kept (deduped).</p>
          <button class="btn btn-primary" style="padding:8px 14px;font-size:12px" onclick="location.hash='#/collect/${encodeURIComponent(topic)}'">Re-run</button>
        </div>
        <div class="settings-card">
          <h4>Ingest local file</h4>
          <p>Drop your interview CSV, Slack export, or call transcript into this topic.</p>
          <button class="btn btn-primary" style="padding:8px 14px;font-size:12px" onclick="location.hash='#/ingest'">Open ingest</button>
        </div>
        <div class="settings-card">
          <h4>Export artifacts</h4>
          <p>Generate shareable HTML + citation-rich markdown.</p>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-primary" style="padding:8px 14px;font-size:12px" id="btn-export-html">Export HTML</button>
            <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line)" id="btn-export-md">Export report.md</button>
          </div>
          <div id="export-status" style="margin-top:10px;font-size:12px;color:var(--ink-3)"></div>
        </div>
        <div class="settings-card" style="border-color:var(--rose)">
          <h4 style="color:#B84747">Danger zone</h4>
          <p>Delete this topic's tags and graph. Underlying posts in SQLite are kept (may be reused by other topics).</p>
          <button class="btn" style="padding:8px 14px;font-size:12px;background:#B84747;color:white" id="btn-delete-topic">Delete topic</button>
        </div>
      </div>
    `;
    $('#btn-export-html').onclick = async () => {
      $('#export-status').textContent = 'exporting HTML…';
      try { const p = await api.exportHtml(topic); $('#export-status').innerHTML = `✓ ${esc(p)}`; }
      catch (e) { $('#export-status').textContent = `✗ ${e?.message || e}`; }
    };
    $('#btn-export-md').onclick = async () => {
      $('#export-status').textContent = 'generating report…';
      try { const p = await api.exportReportPro(topic); $('#export-status').innerHTML = `✓ ${esc(p)}`; }
      catch (e) { $('#export-status').textContent = `✗ ${e?.message || e}`; }
    };
    $('#btn-delete-topic').onclick = async () => {
      if (!confirm(`Delete topic "${topic}"? Graph + tags removed; underlying posts kept.`)) return;
      try {
        await api.deleteTopic(topic);
        location.hash = '#/';
      } catch (e) { alert(`Delete failed: ${e?.message || e}`); }
    };
  }

  const loaders = { map: loadMap, report: loadReport, evidence: loadEvidence, actions: loadActions };
  const switchTab = async (name) => {
    activeTab = name;
    tabsEl.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    await loaders[name]?.();
  };

  tabsEl.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  $('#btn-rerun').onclick = () => { location.hash = `#/collect/${encodeURIComponent(topic)}`; };
  $('#btn-delete').onclick = async () => {
    if (!confirm(`Delete topic "${topic}"?`)) return;
    await api.deleteTopic(topic);
    location.hash = '#/';
  };

  // initial load
  await switchTab('map');
}

function renderMetaPills(metaJson) {
  try {
    const m = JSON.parse(metaJson || '{}');
    const pills = [];
    if (m.classification && m.classification !== 'UNCLASSIFIED') pills.push(`<span style="color:var(--chronic);font-weight:700">${esc(m.classification)}</span>`);
    if (m.severity) pills.push(`severity: ${esc(m.severity)}`);
    if (m.frequency) pills.push(`freq: ${m.frequency}`);
    return pills.map(p => `<span>${p}</span>`).join('');
  } catch { return ''; }
}

/**
 * Tiny markdown renderer (headers, lists, bold, italic, code, blockquote, hr, link).
 * Good enough for report-pro.md; not a full CommonMark impl.
 */
function renderMarkdown(md) {
  const lines = md.split('\n');
  const out = [];
  let inList = false;
  let inQuote = false;
  for (const line of lines) {
    if (line.startsWith('# '))        out.push(`<h1>${inlineMd(line.slice(2))}</h1>`);
    else if (line.startsWith('## '))  out.push(`<h2>${inlineMd(line.slice(3))}</h2>`);
    else if (line.startsWith('### ')) out.push(`<h3>${inlineMd(line.slice(4))}</h3>`);
    else if (line.startsWith('> '))   { if (!inQuote) { out.push('<blockquote>'); inQuote = true; } out.push(inlineMd(line.slice(2))); }
    else if (line.trim() === '---')   out.push('<hr/>');
    else if (line.match(/^[-*]\s/))   { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inlineMd(line.replace(/^[-*]\s/, ''))}</li>`); }
    else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inQuote) { out.push('</blockquote>'); inQuote = false; }
      if (line.trim() === '') out.push('');
      else out.push(`<p>${inlineMd(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  if (inQuote) out.push('</blockquote>');
  return out.join('\n');
}
function inlineMd(s) {
  return s
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}
