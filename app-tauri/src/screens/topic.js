import { api, esc } from '../api.js';
import { convertFileSrc } from '@tauri-apps/api/core';

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
    </header>

    <div class="section-head">
      <div>
        <h2>${esc(topic)}</h2>
        <p id="topic-sub">Loading…</p>
      </div>
      <div class="filter-bar">
        <span class="pill active">Map</span>
        <span class="pill" id="tab-findings">Findings</span>
      </div>
    </div>

    <div id="viewer-slot">
      <div class="empty-state">Exporting viewer…</div>
    </div>
  `;

  root.querySelector('#btn-rerun').addEventListener('click', () => {
    location.hash = `#/collect/${encodeURIComponent(topic)}`;
  });

  try {
    // Ensure graph is built
    await api.buildGraph(topic).catch(() => {});
    // Export HTML (absolute path returned)
    const outPath = await api.exportHtml(topic);
    const fileUrl = convertFileSrc(outPath);
    root.querySelector('#topic-sub').textContent = `Interactive gap map · ${outPath}`;
    root.querySelector('#viewer-slot').innerHTML =
      `<iframe class="viewer-frame" src="${fileUrl}" sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"></iframe>`;
  } catch (e) {
    root.querySelector('#viewer-slot').innerHTML = `
      <div class="empty-big">
        <h3>Couldn't render the gap map</h3>
        <p>${esc(e?.message || e)}</p>
        <button class="btn btn-primary" onclick="location.hash='#/collect/${encodeURIComponent(topic)}'">
          Run collect
        </button>
      </div>`;
  }
}
