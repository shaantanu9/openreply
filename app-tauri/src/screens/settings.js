import { api, esc } from '../api.js';

export async function renderSettings(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Account / <strong>Settings</strong></div>
      <div class="topbar-spacer"></div>
    </header>
    <div class="section-head"><div><h2>Settings</h2><p>Config + keys</p></div></div>
    <div class="settings-grid" id="settings-root">
      <div class="settings-card"><h4>Loading…</h4></div>
    </div>
  `;

  try {
    const info = await api.cliInfo();
    const dataDir = await api.appDataDir();
    const root2 = root.querySelector('#settings-root');
    const t = (info.tables && info.tables) || {};
    root2.innerHTML = `
      <div class="settings-card">
        <h4>Reddit credentials</h4>
        <p>OAuth refresh token (browser-based setup). Stored via <code>reddit-cli auth login</code> in terminal.</p>
        <div class="kv-row"><b>Status</b><span>${info.oauth_ready ? '✓ configured' : '× not configured'}</span></div>
        <div class="kv-row"><b>Mode</b><span>${esc(info.mode || 'public')}</span></div>
      </div>
      <div class="settings-card">
        <h4>LLM keys</h4>
        <p>Optional — Claude-in-MCP also works without setting a key.</p>
        <div class="kv-row"><b>Anthropic</b><span>${info.anthropic_key ? '✓ configured' : '× not configured'}</span></div>
        <div class="kv-row"><b>OpenAI</b><span>${info.openai_key ? '✓ configured' : '× not configured'}</span></div>
      </div>
      <div class="settings-card">
        <h4>Data directory</h4>
        <p>SQLite DB, exports, and cache</p>
        <div class="kv-row"><b>Path</b><span>${esc(dataDir)}</span></div>
        <div class="kv-row"><b>DB</b><span>${esc(info.db_path)}</span></div>
      </div>
      <div class="settings-card">
        <h4>Database stats</h4>
        <p>Table row counts at launch</p>
        ${Object.entries(t).map(([k, v]) => `<div class="kv-row"><b>${esc(k)}</b><span>${v}</span></div>`).join('')}
      </div>
      <div class="settings-card">
        <h4>About</h4>
        <p>Gap Map · v0.1.0 · Python sidecar + Tauri · variant-6 soft-dashboard</p>
      </div>
    `;
  } catch (e) {
    root.querySelector('#settings-root').innerHTML =
      `<div class="settings-card"><h4>Error loading settings</h4><p>${esc(e?.message || e)}</p></div>`;
  }
}
