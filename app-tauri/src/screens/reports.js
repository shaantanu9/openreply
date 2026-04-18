import { api, esc, timeAgo } from '../api.js';

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDate(unixSeconds) {
  if (!unixSeconds) return '';
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleString();
}

export async function renderReports(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Reports</strong></div>
      <div class="topbar-spacer"></div>
    </header>

    <div class="section-head">
      <div>
        <h2>Exports &amp; reports</h2>
        <p>All generated HTML gap maps and markdown reports, stored locally.</p>
      </div>
      <button class="btn btn-ghost" style="border:1px solid var(--line)" id="btn-reveal-data">Reveal data dir</button>
    </div>

    <div id="reports-list">
      <div class="empty-state">loading…</div>
    </div>
  `;

  document.getElementById('btn-reveal-data').onclick = async () => {
    const dir = await api.appDataDir();
    await api.revealInFinder(dir);
  };

  try {
    const files = await api.listExports();
    const list = document.getElementById('reports-list');
    if (!Array.isArray(files) || !files.length) {
      list.innerHTML = `
        <div class="empty-big">
          <h3>No exports yet</h3>
          <p>Open a topic and click <b>Export</b> — gap maps and reports land here.</p>
        </div>
      `;
      return;
    }
    list.innerHTML = files.map(f => {
      const isHtml = f.ext === 'html';
      return `
        <div class="report-item" data-path="${esc(f.path)}" data-ext="${esc(f.ext)}">
          <div class="report-ic ${isHtml ? '' : 'md'}">${isHtml ? '🕸' : '📄'}</div>
          <div class="report-body">
            <div class="report-title">${esc(f.name)}</div>
            <div class="report-meta">${fmtSize(f.size)} · ${fmtDate(f.modified)}</div>
          </div>
          <div class="report-actions">
            <button class="report-btn btn-open">Open</button>
            <button class="report-btn btn-reveal">Reveal</button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.btn-open').forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const path = b.closest('.report-item').dataset.path;
        await api.openUrl(`file://${encodeURI(path)}`);
      };
    });
    list.querySelectorAll('.btn-reveal').forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const path = b.closest('.report-item').dataset.path;
        await api.revealInFinder(path);
      };
    });
  } catch (e) {
    document.getElementById('reports-list').innerHTML =
      `<div class="empty-state">Error: ${esc(e?.message || e)}</div>`;
  }
}
