// Reports — browse every exported artifact (HTML gap maps + markdown reports).
// Filter by kind · search by name · click to preview inline.

import { api, esc, timeAgo } from '../api.js';
import { convertFileSrc } from '@tauri-apps/api/core';

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
function fmtDate(unixSeconds) {
  if (!unixSeconds) return '';
  return new Date(unixSeconds * 1000).toLocaleString();
}

let state = {
  filter: 'all',       // all | html | md
  query: '',
  files: [],
  previewPath: null,
};

export async function renderReports(root) {
  state = { filter: 'all', query: '', files: [], previewPath: null };

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Reports</strong></div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-ghost icon-btn" id="btn-refresh" style="border:1px solid var(--line)"><i data-lucide="rotate-cw"></i> Refresh</button>
      <button class="btn btn-ghost" id="btn-reveal-data" style="border:1px solid var(--line)">Reveal data dir</button>
    </header>

    <div class="section-head">
      <div>
        <h2>Exports &amp; reports</h2>
        <p id="reports-sub">Loading exports…</p>
      </div>
    </div>

    <div class="reports-toolbar">
      <div class="reports-filters">
        <button class="pill active" data-filter="all">All</button>
        <button class="pill" data-filter="html"><i data-lucide="globe"></i> HTML</button>
        <button class="pill" data-filter="md"><i data-lucide="file-text"></i> Markdown</button>
      </div>
      <input type="text" id="reports-search" placeholder="search name…" class="reports-search" />
    </div>

    <div class="reports-layout">
      <div class="reports-list" id="reports-list">
        <div class="empty-state">loading…</div>
      </div>
      <div class="reports-preview" id="reports-preview">
        <div class="empty-state" style="padding:40px">Pick a file to preview it here.</div>
      </div>
    </div>
  `;

  // Wire toolbar
  root.querySelector('#btn-reveal-data').onclick = async () => {
    const dir = await api.appDataDir();
    await api.revealInFinder(dir);
  };
  root.querySelector('#btn-refresh').onclick = () => loadList(root);
  window.refreshIcons?.();

  root.querySelectorAll('.reports-filters .pill').forEach(p => {
    p.onclick = () => {
      root.querySelectorAll('.reports-filters .pill').forEach(x => x.classList.toggle('active', x === p));
      state.filter = p.dataset.filter;
      renderList(root);
    };
  });
  root.querySelector('#reports-search').addEventListener('input', (e) => {
    state.query = e.target.value.toLowerCase();
    renderList(root);
  });

  await loadList(root);
}

async function loadList(root) {
  try {
    const files = await api.listExports();
    state.files = Array.isArray(files) ? files : [];
    root.querySelector('#reports-sub').textContent =
      `${state.files.length} ${state.files.length === 1 ? 'file' : 'files'} on disk · stored locally`;
    renderList(root);
  } catch (e) {
    root.querySelector('#reports-list').innerHTML =
      `<div class="empty-state">Error: ${esc(e?.message || e)}</div>`;
  }
}

function renderList(root) {
  const list = root.querySelector('#reports-list');
  const filtered = state.files.filter(f => {
    if (state.filter === 'html' && f.ext !== 'html') return false;
    if (state.filter === 'md'   && f.ext !== 'md') return false;
    if (state.query && !f.name.toLowerCase().includes(state.query)) return false;
    return true;
  });

  if (!filtered.length) {
    list.innerHTML = state.files.length === 0
      ? `<div class="empty-big">
          <h3>No exports yet</h3>
          <p>Open a topic → Actions → Export — generated artifacts land here.</p>
        </div>`
      : `<div class="empty-state">No files match "${esc(state.query)}"</div>`;
    return;
  }

  list.innerHTML = filtered.map(f => {
    const isHtml = f.ext === 'html';
    const active = state.previewPath === f.path ? 'active' : '';
    return `
      <div class="report-item ${active}" data-path="${esc(f.path)}" data-ext="${esc(f.ext)}">
        <div class="report-ic ${isHtml ? '' : 'md'}"><i data-lucide="${isHtml ? 'globe' : 'file-text'}"></i></div>
        <div class="report-body">
          <div class="report-title">${esc(f.name)}</div>
          <div class="report-meta">${fmtSize(f.size)} · ${esc(timeAgo(new Date(f.modified * 1000).toISOString()))}</div>
        </div>
        <div class="report-actions">
          <button class="report-btn btn-preview">Preview</button>
          <button class="report-btn btn-open">Open</button>
          <button class="report-btn btn-reveal">Reveal</button>
        </div>
      </div>`;
  }).join('');
  window.refreshIcons?.();

  list.querySelectorAll('.report-item').forEach(item => {
    const path = item.dataset.path;
    const ext  = item.dataset.ext;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.report-btn')) return; // handled below
      preview(root, path, ext);
    });
    item.querySelector('.btn-preview').onclick = (e) => { e.stopPropagation(); preview(root, path, ext); };
    item.querySelector('.btn-open').onclick    = (e) => {
      e.stopPropagation();
      api.openUrl(`file://${encodeURI(path)}`);
    };
    item.querySelector('.btn-reveal').onclick  = (e) => {
      e.stopPropagation();
      api.revealInFinder(path);
    };
  });
}

async function preview(root, path, ext) {
  state.previewPath = path;
  renderList(root); // re-render to update .active
  const pane = root.querySelector('#reports-preview');
  const name = path.split('/').pop();
  pane.innerHTML = `<div class="empty-state" style="padding:40px">loading ${esc(name)}…</div>`;

  try {
    if (ext === 'html') {
      const url = convertFileSrc(path);
      pane.innerHTML = `
        <div class="report-preview-head">
          <b>${esc(name)}</b>
          <div>
            <button class="btn btn-ghost btn-xs btn-bordered" id="pv-open">Open externally</button>
            <button class="btn btn-ghost btn-xs btn-bordered" id="pv-reveal">Reveal</button>
          </div>
        </div>
        <iframe class="viewer-frame" src="${url}" sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"></iframe>`;
    } else {
      // md
      const url = convertFileSrc(path);
      const resp = await fetch(url);
      const md = await resp.text();
      pane.innerHTML = `
        <div class="report-preview-head">
          <b>${esc(name)}</b>
          <div>
            <button class="btn btn-ghost btn-xs btn-bordered icon-btn" id="pv-copy"><i data-lucide="copy"></i> Copy</button>
            <button class="btn btn-ghost btn-xs btn-bordered" id="pv-open">Open externally</button>
            <button class="btn btn-ghost btn-xs btn-bordered" id="pv-reveal">Reveal</button>
          </div>
        </div>
        <div class="markdown-view" style="padding:18px 24px">${renderMd(md)}</div>`;
      window.refreshIcons?.();
      pane.querySelector('#pv-copy').onclick = () => {
        navigator.clipboard.writeText(md);
        const b = pane.querySelector('#pv-copy');
        b.innerHTML = '<i data-lucide="check"></i> copied';
        window.refreshIcons?.();
        setTimeout(() => { b.innerHTML = '<i data-lucide="copy"></i> Copy'; window.refreshIcons?.(); }, 1500);
      };
    }
    pane.querySelector('#pv-open').onclick   = () => api.openUrl(`file://${encodeURI(path)}`);
    pane.querySelector('#pv-reveal').onclick = () => api.revealInFinder(path);
  } catch (e) {
    pane.innerHTML = `<div class="empty-state">Error: ${esc(e?.message || e)}</div>`;
  }
}

function renderMd(md) {
  const lines = (md || '').split('\n');
  const out = [];
  let inList = false, inCode = false, inQuote = false;
  for (const line of lines) {
    if (line.startsWith('```')) { out.push(inCode ? '</code></pre>' : '<pre><code>'); inCode = !inCode; continue; }
    if (inCode) { out.push(esc(line)); continue; }
    if (line.startsWith('# '))       out.push(`<h1>${inl(line.slice(2))}</h1>`);
    else if (line.startsWith('## ')) out.push(`<h2>${inl(line.slice(3))}</h2>`);
    else if (line.startsWith('### '))out.push(`<h3>${inl(line.slice(4))}</h3>`);
    else if (line.startsWith('> '))  { if (!inQuote) { out.push('<blockquote>'); inQuote = true; } out.push(inl(line.slice(2))); }
    else if (line.trim() === '---')  out.push('<hr/>');
    else if (line.match(/^[-*]\s/))  { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inl(line.replace(/^[-*]\s/, ''))}</li>`); }
    else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inQuote) { out.push('</blockquote>'); inQuote = false; }
      out.push(line.trim() ? `<p>${inl(line)}</p>` : '');
    }
  }
  if (inList) out.push('</ul>');
  if (inQuote) out.push('</blockquote>');
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}
function inl(s) {
  return s
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}
