// Settings v2 — profile + multi-LLM status + reddit + data + preferences + danger.
//
// Profile is stored locally in localStorage (no server auth — this is a
// desktop app). The avatar initials derived from the name also render in
// the dashboard header.

import { api, esc } from '../api.js';
import { openByokModal } from './byok.js';

const PROFILE_KEYS = {
  name: 'gapmap.profile.name',
  email: 'gapmap.profile.email',
  role: 'gapmap.profile.role',
};

const LLM_LABELS = {
  anthropic:  'Anthropic',
  openai:     'OpenAI',
  openrouter: 'OpenRouter',
  groq:       'Groq',
  deepseek:   'DeepSeek',
  mistral:    'Mistral',
  google:     'Google Gemini',
  ollama:     'Ollama (local)',
};

function getProfile() {
  return {
    name:  localStorage.getItem(PROFILE_KEYS.name)  || '',
    email: localStorage.getItem(PROFILE_KEYS.email) || '',
    role:  localStorage.getItem(PROFILE_KEYS.role)  || 'researcher',
  };
}
function saveProfile(p) {
  if (p.name  != null) localStorage.setItem(PROFILE_KEYS.name,  p.name);
  if (p.email != null) localStorage.setItem(PROFILE_KEYS.email, p.email);
  if (p.role  != null) localStorage.setItem(PROFILE_KEYS.role,  p.role);
}
export function avatarInitials(name) {
  const n = (name || '').trim();
  if (!n) return 'GM';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarColor(name) {
  const palette = ['#FF8C42', '#7BA88C', '#B084CC', '#4A90A4', '#D4A574', '#C87070', '#5B8DB8', '#9B7EBD'];
  let h = 0;
  for (const c of (name || 'gapmap')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

function fmtBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export async function renderSettings(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Account / <strong>Settings</strong></div>
      <div class="topbar-spacer"></div>
    </header>
    <div class="section-head"><div><h2>Settings</h2><p>Profile · keys · data · preferences</p></div></div>
    <div id="settings-root">
      <div class="settings-grid">
        <div class="settings-card"><h4>Loading…</h4></div>
      </div>
    </div>
  `;

  let byok = {};
  let info = {};
  let dataDir = '';
  let dbSize = null;

  try { byok = await api.byokStatus(); } catch {}
  try { info = await api.cliInfo(); } catch {}
  try { dataDir = await api.appDataDir(); } catch {}

  // Size of the SQLite DB for the "Data" card.
  try {
    const rows = await api.runQuery(
      `SELECT (page_count * page_size) AS bytes FROM pragma_page_count, pragma_page_size`
    );
    if (Array.isArray(rows) && rows[0]?.bytes) dbSize = rows[0].bytes;
  } catch {}

  const profile = getProfile();
  const providers = Object.keys(LLM_LABELS);
  const readyCount = providers.reduce((a, k) => {
    const st = byok?.[k];
    if (!st) return a;
    if (k === 'ollama') return a + (typeof st === 'string' && st ? 1 : 0);
    return a + (st.set ? 1 : 0);
  }, 0);
  const llmProvider = byok?.llm_provider || '';
  const llmModel = byok?.llm_model || '';
  const t = (info.tables && info.tables) || {};
  const slot = root.querySelector('#settings-root');

  slot.innerHTML = `
    <div class="settings-grid">
      <!-- PROFILE -->
      <div class="settings-card settings-profile">
        <div class="settings-profile-head">
          <div class="settings-avatar" id="settings-avatar"
               style="background:${avatarColor(profile.name)}">
            ${esc(avatarInitials(profile.name))}
          </div>
          <div>
            <h4 style="margin:0">${esc(profile.name || 'Your profile')}</h4>
            <p style="margin:2px 0 0;color:var(--ink-3);font-size:12px">${esc(profile.email || 'no email set')}</p>
          </div>
        </div>
        <div class="settings-profile-fields">
          <label>
            <span>Display name</span>
            <input type="text" id="profile-name" value="${esc(profile.name)}" placeholder="e.g. Alex Park" />
          </label>
          <label>
            <span>Email (optional)</span>
            <input type="email" id="profile-email" value="${esc(profile.email)}" placeholder="optional — only used locally" />
          </label>
          <label>
            <span>Role</span>
            <select id="profile-role">
              ${['researcher', 'founder', 'designer', 'engineer', 'pm', 'marketer', 'other']
                .map(r => `<option value="${r}" ${r === profile.role ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
          </label>
          <div class="settings-profile-actions">
            <button class="btn btn-primary" id="profile-save" style="padding:8px 14px;font-size:12px">Save profile</button>
            <span class="settings-profile-status" id="profile-status"></span>
          </div>
        </div>
      </div>

      <!-- LLM STATUS -->
      <div class="settings-card">
        <h4>LLM providers <span style="color:var(--ink-3);font-size:12px;font-weight:500">${readyCount} ready</span></h4>
        <p>${esc(byok?.path || '~/.config/reddit-myind/.env')}</p>
        <div class="llm-grid">
          ${providers.map(k => {
            const st = byok?.[k];
            const isOllama = k === 'ollama';
            const ready = isOllama ? (typeof st === 'string' && !!st) : !!st?.set;
            const preview = isOllama ? (st || '') : (st?.preview || '');
            return `
              <div class="llm-chip ${ready ? 'on' : 'off'}">
                <span class="llm-chip-name">${esc(LLM_LABELS[k])}</span>
                <span class="llm-chip-state">${ready ? (preview ? `✓ ${esc(preview)}` : '✓ ready') : '× not set'}</span>
              </div>`;
          }).join('')}
        </div>
        <div class="kv-row" style="margin-top:12px"><b>Default provider</b>
          <span>${llmProvider ? esc(LLM_LABELS[llmProvider] || llmProvider) : '—'}</span>
        </div>
        ${llmModel ? `<div class="kv-row"><b>Default model</b><span>${esc(llmModel)}</span></div>` : ''}
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" style="padding:8px 14px;font-size:12px" id="btn-manage-keys">🗝 Manage keys</button>
          <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line)" id="btn-reveal-env">Reveal .env</button>
        </div>
      </div>

      <!-- REDDIT -->
      <div class="settings-card">
        <h4>Reddit source</h4>
        <p>Without credentials we use public <code>.json</code> endpoints (60/min). With client ID + secret the rate limit jumps to 100/min.</p>
        <div class="kv-row"><b>Mode</b><span>${esc(info.mode || 'public')}</span></div>
        <div class="kv-row"><b>Client ID</b><span>${byok?.reddit_client_id?.set ? `✓ ${esc(byok.reddit_client_id.preview)}` : '× not set'}</span></div>
        <div class="kv-row"><b>Client secret</b><span>${byok?.reddit_client_secret?.set ? `✓ ${esc(byok.reddit_client_secret.preview)}` : '× not set'}</span></div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line)" id="btn-reddit-apps">Create Reddit app</button>
          <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line)" id="btn-auth-docs">Setup guide</button>
        </div>
      </div>

      <!-- DATA -->
      <div class="settings-card">
        <h4>Local data</h4>
        <p>Everything Gap Map knows lives here. Nothing uploaded.</p>
        <div class="kv-row"><b>Directory</b><span title="${esc(dataDir)}">${esc(dataDir)}</span></div>
        <div class="kv-row"><b>SQLite DB</b><span title="${esc(info.db_path || '')}">${esc(info.db_path || '—')}</span></div>
        <div class="kv-row"><b>DB size</b><span>${dbSize != null ? fmtBytes(dbSize) : '—'}</span></div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line)" id="btn-reveal-data">Reveal in Finder</button>
          <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line)" id="btn-open-db">Open Database console →</button>
        </div>
      </div>

      <!-- TABLE COUNTS -->
      <div class="settings-card">
        <h4>Table counts</h4>
        <p>As reported by the CLI at launch</p>
        ${Object.entries(t).length
          ? Object.entries(t).map(([k, v]) => `<div class="kv-row"><b>${esc(k)}</b><span>${v}</span></div>`).join('')
          : `<div class="empty-state" style="padding:12px">No table info yet — run a collect to populate.</div>`}
      </div>

      <!-- PREFERENCES -->
      <div class="settings-card">
        <h4>Preferences</h4>
        <p>Behaviour knobs</p>
        <label class="settings-toggle">
          <input type="checkbox" id="pref-aggressive" ${localStorage.getItem('gapmap.pref.aggressive') === 'false' ? '' : 'checked'} />
          <span><b>Aggressive mode by default</b><small>Pull all sources + historical archive on every new topic.</small></span>
        </label>
        <label class="settings-toggle">
          <input type="checkbox" id="pref-confirm-delete" ${localStorage.getItem('gapmap.pref.confirm_delete') === 'false' ? '' : 'checked'} />
          <span><b>Confirm before deleting a topic</b><small>Uncheck for one-click deletes.</small></span>
        </label>
      </div>

      <!-- ONBOARDING + HELP -->
      <div class="settings-card">
        <h4>Onboarding &amp; help</h4>
        <p>Re-run the welcome wizard or open the docs.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line)" id="btn-reset-onboarding">Reset onboarding</button>
          <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line)" id="btn-open-science">Methodology →</button>
          <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line)" id="btn-open-readme">GitHub readme</button>
        </div>
      </div>

      <!-- ABOUT + DANGER -->
      <div class="settings-card" style="border-color:var(--rose, #F5DADA);background:#FFFBFB">
        <h4 style="color:#B84747">⚠ Danger zone</h4>
        <p>These actions can't be undone.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <button class="btn" style="padding:8px 14px;font-size:12px;background:#B84747;color:white;border:none" id="btn-clear-profile">Clear profile</button>
          <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid #E8C8C8;color:#B84747" id="btn-clear-prefs">Reset all preferences</button>
        </div>
      </div>

      <!-- ABOUT -->
      <div class="settings-card">
        <h4>About</h4>
        <p>Gap Map · v0.1.0 · Python sidecar + Tauri · variant-6 soft-dashboard</p>
        <div class="kv-row"><b>CLI mode</b><span>${esc(info.mode || 'public')}</span></div>
      </div>
    </div>
  `;

  // --- wire profile ---
  const avatarEl = slot.querySelector('#settings-avatar');
  const nameInput = slot.querySelector('#profile-name');
  const emailInput = slot.querySelector('#profile-email');
  const roleSelect = slot.querySelector('#profile-role');
  const profileStatus = slot.querySelector('#profile-status');

  nameInput.addEventListener('input', () => {
    avatarEl.textContent = avatarInitials(nameInput.value);
    avatarEl.style.background = avatarColor(nameInput.value);
  });
  slot.querySelector('#profile-save').addEventListener('click', () => {
    saveProfile({
      name: nameInput.value.trim(),
      email: emailInput.value.trim(),
      role: roleSelect.value,
    });
    profileStatus.textContent = '✓ saved';
    profileStatus.style.color = '#2E7D5B';
    // Broadcast so the home header avatar refreshes on next visit.
    window.dispatchEvent(new CustomEvent('gapmap:profile-updated'));
    setTimeout(() => { profileStatus.textContent = ''; }, 2000);
  });

  // --- wire rest ---
  slot.querySelector('#btn-manage-keys')?.addEventListener('click', () => {
    openByokModal(() => renderSettings(root));
  });
  slot.querySelector('#btn-reveal-env')?.addEventListener('click', () => {
    if (byok.path) api.revealInFinder(byok.path);
  });
  slot.querySelector('#btn-reddit-apps')?.addEventListener('click', () => {
    api.openUrl('https://www.reddit.com/prefs/apps');
  });
  slot.querySelector('#btn-auth-docs')?.addEventListener('click', () => {
    api.openUrl('https://github.com/shaantanu98/reddit-myind#readme');
  });
  slot.querySelector('#btn-reveal-data')?.addEventListener('click', () => {
    if (dataDir) api.revealInFinder(dataDir);
  });
  slot.querySelector('#btn-open-db')?.addEventListener('click', () => {
    location.hash = '#/database';
  });
  slot.querySelector('#btn-reset-onboarding')?.addEventListener('click', () => {
    try { localStorage.removeItem('gapmap.onboarding.completed'); } catch {}
    location.hash = '#/welcome';
  });
  slot.querySelector('#btn-open-science')?.addEventListener('click', () => {
    location.hash = '#/science';
  });
  slot.querySelector('#btn-open-readme')?.addEventListener('click', () => {
    api.openUrl('https://github.com/shaantanu98/reddit-myind');
  });
  slot.querySelector('#pref-aggressive')?.addEventListener('change', (e) => {
    localStorage.setItem('gapmap.pref.aggressive', e.target.checked ? 'true' : 'false');
  });
  slot.querySelector('#pref-confirm-delete')?.addEventListener('change', (e) => {
    localStorage.setItem('gapmap.pref.confirm_delete', e.target.checked ? 'true' : 'false');
  });
  slot.querySelector('#btn-clear-profile')?.addEventListener('click', () => {
    if (!confirm('Clear your local profile (name/email/role)? LLM keys stay.')) return;
    Object.values(PROFILE_KEYS).forEach(k => localStorage.removeItem(k));
    renderSettings(root);
  });
  slot.querySelector('#btn-clear-prefs')?.addEventListener('click', () => {
    if (!confirm('Reset every local preference? LLM keys + DB stay untouched.')) return;
    Object.keys(localStorage)
      .filter(k => k.startsWith('gapmap.'))
      .filter(k => !k.startsWith('gapmap.onboarding')) // keep onboarding flag so user doesn't re-wizard
      .forEach(k => localStorage.removeItem(k));
    renderSettings(root);
  });
}
