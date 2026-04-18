import { api, esc } from '../api.js';
import { openByokModal } from './byok.js';

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

  let byok = { anthropic: {}, openai: {}, reddit_client_id: {}, reddit_client_secret: {}, path: '' };
  try {
    byok = await api.byokStatus();
  } catch {}

  try {
    const info = await api.cliInfo();
    const dataDir = await api.appDataDir();
    const root2 = root.querySelector('#settings-root');
    const t = (info.tables && info.tables) || {};
    const keyRow = (label, st) => `
      <div class="kv-row"><b>${esc(label)}</b>
        <span>${st?.set ? `✓ ${esc(st.preview)}` : '× not set'}</span>
      </div>`;
    root2.innerHTML = `
      <div class="settings-card">
        <h4>API keys <span style="color:var(--ink-3);font-size:12px;font-weight:500">(BYOK)</span></h4>
        <p>Stored locally at <code>${esc(byok.path || '~/.config/reddit-myind/.env')}</code>. Never uploaded.</p>
        ${keyRow('Anthropic',            byok.anthropic)}
        ${keyRow('OpenAI',               byok.openai)}
        ${keyRow('Reddit client ID',     byok.reddit_client_id)}
        ${keyRow('Reddit client secret', byok.reddit_client_secret)}
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" style="padding:8px 14px;font-size:12px" id="btn-manage-keys">🗝 Manage keys</button>
          <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line)" id="btn-reveal-env">Reveal .env</button>
        </div>
      </div>
      <div class="settings-card">
        <h4>Reddit source</h4>
        <p>Without credentials we use public <code>.json</code> endpoints (60/min). With client ID + secret, rate limit jumps to 100/min.</p>
        <div class="kv-row"><b>Current mode</b><span>${esc(info.mode || 'public')}</span></div>
        <div style="margin-top:12px;display:flex;gap:8px">
          <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line)" id="btn-reddit-apps">
            Create Reddit app
          </button>
          <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line)" id="btn-auth-docs">
            Setup guide
          </button>
        </div>
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
        <h4>Onboarding</h4>
        <p>Reset the welcome wizard — next launch will show the 3-step setup again.</p>
        <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line);margin-top:6px" id="btn-reset-onboarding">Reset onboarding</button>
      </div>
      <div class="settings-card">
        <h4>About</h4>
        <p>Gap Map · v0.1.0 · Python sidecar + Tauri · variant-6 soft-dashboard</p>
      </div>
    `;
    // Wire buttons
    root.querySelector('#btn-reddit-apps')?.addEventListener('click', () => {
      api.openUrl('https://www.reddit.com/prefs/apps');
    });
    root.querySelector('#btn-auth-docs')?.addEventListener('click', () => {
      api.openUrl('https://github.com/shaantanu98/reddit-myind/blob/master/README.md');
    });
    root.querySelector('#btn-manage-keys')?.addEventListener('click', () => {
      openByokModal(() => renderSettings(root));
    });
    root.querySelector('#btn-reveal-env')?.addEventListener('click', () => {
      if (byok.path) api.revealInFinder(byok.path);
    });
    root.querySelector('#btn-reset-onboarding')?.addEventListener('click', () => {
      try { localStorage.removeItem('gapmap.onboarding.completed'); } catch {}
      location.hash = '#/welcome';
    });
  } catch (e) {
    root.querySelector('#settings-root').innerHTML =
      `<div class="settings-card"><h4>Error loading settings</h4><p>${esc(e?.message || e)}</p></div>`;
  }
}
