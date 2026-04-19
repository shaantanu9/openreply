// Settings — renders instantly with the profile card + skeletons, then
// fills in each card as its sidecar call returns. No call blocks the UI.

import { api, esc } from '../api.js';
import { openByokModal } from './byok.js';

const PROFILE_KEYS = {
  name:  'gapmap.profile.name',
  email: 'gapmap.profile.email',
  role:  'gapmap.profile.role',
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
  // Stamp the route generation so async callbacks can detect navigation-away
  // and skip DOM writes. Same pattern as science.js.
  const myGen = root.dataset.routeGen;
  const alive = () => root.dataset.routeGen === myGen && root.isConnected;
  const profile = getProfile();

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Account / <strong>Settings</strong></div>
      <div class="topbar-spacer"></div>
    </header>
    <div class="section-head"><div><h2>Settings</h2><p>Profile · keys · data · preferences</p></div></div>

    <div class="settings-grid" id="settings-grid">
      <!-- PROFILE (renders instantly) -->
      <div class="settings-card settings-profile">
        <div class="settings-profile-head">
          <div class="settings-avatar" id="settings-avatar" style="background:${avatarColor(profile.name)}">
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
            <button class="btn btn-primary btn-sm" id="profile-save">Save profile</button>
            <span class="settings-profile-status" id="profile-status"></span>
          </div>
        </div>
      </div>

      <!-- LLM card (skeleton → filled) -->
      <div class="settings-card" id="card-llm">
        <h4>LLM providers <span style="color:var(--ink-3);font-size:12px;font-weight:500">loading…</span></h4>
        <p style="color:var(--ink-3)">Reading your .env file…</p>
        <div class="skel skel-line" style="width:100%;margin-top:10px"></div>
        <div class="skel skel-line" style="width:85%"></div>
        <div class="skel skel-line" style="width:70%"></div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm icon-btn" id="btn-manage-keys-eager"><i data-lucide="key-round"></i> Manage keys</button>
        </div>
      </div>

      <!-- Reddit card -->
      <div class="settings-card" id="card-reddit">
        <h4>Reddit source</h4>
        <p style="color:var(--ink-3)">Loading status…</p>
        <div class="skel skel-line" style="width:60%;margin-top:10px"></div>
      </div>

      <!-- Data card -->
      <div class="settings-card" id="card-data">
        <h4>Local data</h4>
        <p style="color:var(--ink-3)">Checking disk usage…</p>
        <div class="skel skel-line" style="width:80%;margin-top:10px"></div>
        <div class="skel skel-line" style="width:65%"></div>
      </div>

      <!-- Semantic search (palace) — opt-in on-device model download -->
      <div class="settings-card" id="card-palace">
        <h4>Semantic search <span style="color:var(--ink-3);font-size:12px;font-weight:500">loading…</span></h4>
        <p style="color:var(--ink-3)">Checking model status…</p>
        <div class="skel skel-line" style="width:70%;margin-top:10px"></div>
      </div>

      <!-- Tables -->
      <div class="settings-card" id="card-tables">
        <h4>Table counts</h4>
        <p>As reported by the CLI at launch</p>
        <div class="empty-state" style="padding:12px">loading…</div>
      </div>

      <!-- Scheduled runs -->
      <div class="settings-card" id="card-schedule">
        <h4>Scheduled runs</h4>
        <p>Re-run collect automatically for opted-in topics. macOS only (launchd).</p>
        <div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap">
          <select id="schedule-interval" class="select-sm">
            <option value="0">Off</option>
            <option value="6">Every 6 hours</option>
            <option value="24">Every day</option>
            <option value="168">Every week</option>
          </select>
          <span id="schedule-status-text" style="font-size:12px;color:var(--ink-3)">…</span>
        </div>
        <p style="font-size:11.5px;color:var(--ink-3);margin-top:8px">
          Only topics you toggle on (from their page) will be refreshed. Logs go to
          <code>~/Library/Application Support/com.shantanu.gapmap/reddit-myind/schedule.log</code>.
        </p>
      </div>

      <!-- Preferences -->
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

      <!-- Onboarding + help -->
      <div class="settings-card">
        <h4>Onboarding &amp; help</h4>
        <p>Re-run the welcome wizard or open the docs.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <button class="btn btn-ghost btn-sm btn-bordered" id="btn-reset-onboarding">Reset onboarding</button>
          <button class="btn btn-ghost btn-sm btn-bordered" id="btn-open-science">Methodology →</button>
          <button class="btn btn-ghost btn-sm btn-bordered" id="btn-open-readme">GitHub readme</button>
        </div>
      </div>

      <!-- Danger -->
      <div class="settings-card" style="border-color:#F5DADA;background:#FFFBFB">
        <h4 style="color:#B84747"><i data-lucide="alert-triangle"></i> Danger zone</h4>
        <p>These actions can't be undone.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <button class="btn btn-danger btn-sm" id="btn-clear-profile">Clear profile</button>
          <button class="btn btn-danger-ghost btn-sm" id="btn-clear-prefs">Reset all preferences</button>
        </div>
      </div>

      <!-- MCP (for Claude Code / Claude.com integration) -->
      <div class="settings-card">
        <h4>Use with Claude Code</h4>
        <p>Gap Map ships an MCP server so Claude Code and Claude.com can query your local corpus directly.</p>
        <div style="font-family:ui-monospace,monospace;font-size:12px;background:var(--surface-2);padding:10px 12px;border-radius:8px;margin:10px 0">
          <code># one-liner install (Claude Code)</code><br/>
          <code>reddit-cli mcp install</code>
        </div>
        <p style="font-size:11.5px;color:var(--ink-3);margin-top:6px">
          Exposes 40+ tools: <code>reddit_fetch_posts</code>, <code>reddit_discover_subs</code>,
          <code>reddit_graph_build</code>, <code>reddit_query_db</code>, etc. No auto-start — launch on demand.
        </p>
        <div style="margin-top:10px">
          <button class="btn btn-ghost btn-sm btn-bordered" id="btn-mcp-docs">MCP spec →</button>
        </div>
      </div>

      <!-- About -->
      <div class="settings-card">
        <h4>About</h4>
        <p>Gap Map · v0.1.0 · Python sidecar + Tauri · variant-6 soft-dashboard</p>
      </div>

      <div id="settings-err" style="grid-column:1/-1;color:#B84747;font-size:12px"></div>
    </div>
  `;

  wireProfileCard(root);
  wireStaticButtons(root);

  // Always-available buttons while the async data loads
  root.querySelector('#btn-manage-keys-eager').onclick = () => openByokModal(() => renderSettings(root));

  // Fetch everything in parallel; fill cards independently as each resolves.
  // `alive()` guards every DOM write so a stale async response from a
  // previous mount can't clobber the current screen.
  api.byokStatus()
    .then(byok => { if (alive()) fillLlmCard(root, byok); return byok; })
    .then(byok => { if (alive()) fillRedditCard(root, byok); })
    .catch(e => { if (alive()) reportError(root, 'keys', e); });

  api.cliInfo()
    .then(info => { if (alive()) fillTablesCard(root, info); })
    .catch(e => { if (alive()) reportError(root, 'info', e); });

  Promise.all([api.appDataDir(), api.cliInfo().catch(() => ({}))])
    .then(async ([dataDir, info]) => {
      let dbSize = null;
      try {
        const rows = await api.runQuery(
          `SELECT (page_count * page_size) AS bytes FROM pragma_page_count, pragma_page_size`
        );
        if (Array.isArray(rows) && rows[0]?.bytes) dbSize = rows[0].bytes;
      } catch {}
      if (alive()) fillDataCard(root, info, dataDir, dbSize);
    })
    .catch(e => { if (alive()) reportError(root, 'data', e); });

  // Palace / semantic-search card. Pull status + current doc count in
  // parallel, then render the right state (not-installed | not-ready |
  // ready).
  Promise.all([
    api.palaceModelStatus().catch(() => ({ installed: false, ready: false })),
    api.palaceStats().catch(() => ({ ok: false, count: 0 })),
  ])
    .then(([ms, ps]) => { if (alive()) fillPalaceCard(root, ms, ps); })
    .catch(e => { if (alive()) reportError(root, 'palace', e); });
}

// --- Profile card (sync) ----------------------------------------------------
function wireProfileCard(root) {
  const nameInput  = root.querySelector('#profile-name');
  const emailInput = root.querySelector('#profile-email');
  const roleSelect = root.querySelector('#profile-role');
  const avatarEl   = root.querySelector('#settings-avatar');
  const statusEl   = root.querySelector('#profile-status');

  nameInput.addEventListener('input', () => {
    avatarEl.textContent = avatarInitials(nameInput.value);
    avatarEl.style.background = avatarColor(nameInput.value);
  });
  root.querySelector('#profile-save').addEventListener('click', () => {
    saveProfile({ name: nameInput.value.trim(), email: emailInput.value.trim(), role: roleSelect.value });
    statusEl.textContent = '✓ saved';
    statusEl.style.color = '#2E7D5B';
    window.dispatchEvent(new CustomEvent('gapmap:profile-updated'));
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });
}

// --- Static buttons (sync) --------------------------------------------------
function wireStaticButtons(root) {
  root.querySelector('#pref-aggressive')?.addEventListener('change', e => {
    localStorage.setItem('gapmap.pref.aggressive', e.target.checked ? 'true' : 'false');
  });

  // --- Scheduled runs ---
  (async () => {
    const sel = root.querySelector('#schedule-interval');
    const status = root.querySelector('#schedule-status-text');
    if (!sel || !status) return;
    try {
      const s = await api.scheduleStatus();
      if (s && s.reason) {
        status.textContent = s.reason;
        sel.disabled = true;
      } else if (s && s.loaded) {
        status.textContent = 'Enabled · launchd agent loaded';
      } else if (s && s.installed) {
        status.textContent = 'Plist exists but not loaded — try reselecting interval';
      } else {
        status.textContent = 'Off';
      }
    } catch (e) { status.textContent = 'status unavailable'; }
    sel.addEventListener('change', async e => {
      const hours = Number(e.target.value) || 0;
      status.textContent = '…';
      try {
        if (hours === 0) {
          const r = await api.scheduleUninstall();
          status.textContent = r?.uninstalled ? 'Off' : (r?.reason || 'uninstall failed');
        } else {
          const r = await api.scheduleInstall(hours);
          if (r && r.installed === false && r.reason) {
            status.textContent = r.reason;
          } else {
            status.textContent = `Enabled · every ${hours}h`;
          }
        }
      } catch (err) {
        status.textContent = `error: ${err?.message || err}`;
      }
    });
  })();
  root.querySelector('#pref-confirm-delete')?.addEventListener('change', e => {
    localStorage.setItem('gapmap.pref.confirm_delete', e.target.checked ? 'true' : 'false');
  });
  root.querySelector('#btn-reset-onboarding')?.addEventListener('click', () => {
    try { localStorage.removeItem('gapmap.onboarding.completed'); } catch {}
    location.hash = '#/welcome';
  });
  root.querySelector('#btn-open-science')?.addEventListener('click', () => { location.hash = '#/science'; });
  root.querySelector('#btn-open-readme')?.addEventListener('click', () => api.openUrl('https://github.com/shaantanu98/reddit-myind'));
  root.querySelector('#btn-mcp-docs')?.addEventListener('click', () => api.openUrl('https://modelcontextprotocol.io/docs'));
  root.querySelector('#btn-clear-profile')?.addEventListener('click', () => {
    if (!confirm('Clear your local profile (name/email/role)? LLM keys stay.')) return;
    Object.values(PROFILE_KEYS).forEach(k => localStorage.removeItem(k));
    renderSettings(root);
  });
  root.querySelector('#btn-clear-prefs')?.addEventListener('click', () => {
    if (!confirm('Reset every local preference? LLM keys + DB stay untouched.')) return;
    Object.keys(localStorage)
      .filter(k => k.startsWith('gapmap.'))
      .filter(k => !k.startsWith('gapmap.onboarding'))
      .forEach(k => localStorage.removeItem(k));
    renderSettings(root);
  });
}

// --- Async card fillers -----------------------------------------------------
function fillLlmCard(root, byok) {
  const providers = Object.keys(LLM_LABELS);
  const readyCount = providers.reduce((a, k) => {
    const st = byok?.[k];
    if (!st) return a;
    if (k === 'ollama') return a + (typeof st === 'string' && st ? 1 : 0);
    return a + (st.set ? 1 : 0);
  }, 0);
  const llmProvider = byok?.llm_provider || '';
  const llmModel = byok?.llm_model || '';

  const card = root.querySelector('#card-llm');
  if (!card) return;
  card.innerHTML = `
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
      <button class="btn btn-primary btn-sm icon-btn" id="btn-manage-keys"><i data-lucide="key-round"></i> Manage keys</button>
      <button class="btn btn-ghost btn-sm btn-bordered" id="btn-reveal-env">Reveal .env</button>
    </div>`;
  card.querySelector('#btn-manage-keys').onclick = () => openByokModal(() => renderSettings(root));
  card.querySelector('#btn-reveal-env').onclick = () => { if (byok?.path) api.revealInFinder(byok.path); };
  window.refreshIcons?.();
}

function fillRedditCard(root, byok) {
  const card = root.querySelector('#card-reddit');
  if (!card) return;
  const cid = byok?.reddit_client_id;
  const sec = byok?.reddit_client_secret;
  card.innerHTML = `
    <h4>Reddit source</h4>
    <p>Public <code>.json</code> gives 60/min; with creds, 100/min.</p>
    <div class="kv-row"><b>Client ID</b><span>${cid?.set ? `✓ ${esc(cid.preview)}` : '× not set'}</span></div>
    <div class="kv-row"><b>Client secret</b><span>${sec?.set ? `✓ ${esc(sec.preview)}` : '× not set'}</span></div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm btn-bordered" id="btn-reddit-apps">Create Reddit app</button>
      <button class="btn btn-ghost btn-sm btn-bordered" id="btn-auth-docs">Setup guide</button>
    </div>`;
  card.querySelector('#btn-reddit-apps').onclick = () => api.openUrl('https://www.reddit.com/prefs/apps');
  card.querySelector('#btn-auth-docs').onclick   = () => api.openUrl('https://github.com/shaantanu98/reddit-myind#readme');
}

function fillDataCard(root, info, dataDir, dbSize) {
  const card = root.querySelector('#card-data');
  if (!card) return;
  // dbSize>0 means the db actually opened and pragma_page_count returned —
  // that's our positive proof of "connected".
  const dbConnected = dbSize != null;
  card.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between">
      <h4>Local data</h4>
      <span class="pill ${dbConnected ? 'active' : ''}" style="${dbConnected ? 'background:var(--mint-soft);color:#2E7D5B' : 'color:#B84747'}">
        <i data-lucide="${dbConnected ? 'database' : 'database-zap'}"></i>
        ${dbConnected ? 'DB connected' : 'DB unreachable'}
      </span>
    </div>
    <p>Everything Gap Map knows lives here.</p>
    <div class="kv-row"><b>Directory</b><span title="${esc(dataDir || '')}">${esc(dataDir || '—')}</span></div>
    <div class="kv-row"><b>SQLite DB</b><span title="${esc(info?.db_path || '')}">${esc(info?.db_path || '—')}</span></div>
    <div class="kv-row"><b>DB size</b><span>${dbSize != null ? fmtBytes(dbSize) : '—'}</span></div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm btn-bordered" id="btn-reveal-data">Reveal in Finder</button>
      <button class="btn btn-ghost btn-sm btn-bordered" id="btn-open-db">Open Database console →</button>
    </div>`;
  card.querySelector('#btn-reveal-data').onclick = () => { if (dataDir) api.revealInFinder(dataDir); };
  card.querySelector('#btn-open-db').onclick     = () => { location.hash = '#/database'; };
  window.refreshIcons?.();
}

function fillTablesCard(root, info) {
  const card = root.querySelector('#card-tables');
  if (!card) return;
  const t = info?.tables || {};
  card.innerHTML = `
    <h4>Table counts</h4>
    <p>As reported by the CLI at launch</p>
    ${Object.entries(t).length
      ? Object.entries(t).map(([k, v]) => `<div class="kv-row"><b>${esc(k)}</b><span>${v}</span></div>`).join('')
      : `<div class="empty-state" style="padding:12px">No table info yet — run a collect to populate.</div>`}
  `;
}

// ─── Palace (semantic search) card ──────────────────────────────────────────
// Three visible states:
//   1. "not installed" — retrieval extras wheel missing from the sidecar.
//      This happens on lean prod builds. Show why, skip the Enable button.
//   2. "ready to enable" — extras installed, ONNX model not cached yet.
//      Shows the opt-in "Enable — 80 MB download" button. Progress bar
//      takes over when the button is clicked.
//   3. "enabled" — model cached. Show doc count + Reindex action.
//
// localStorage flag `gapmap.palace.declined` lets the user opt out; we
// render a muted "Enable anyway" link instead of the primary button.
const PALACE_DECLINED_KEY = 'gapmap.palace.declined';

function fillPalaceCard(root, ms, ps) {
  const card = root.querySelector('#card-palace');
  if (!card) return;

  const installed = !!ms?.installed;
  const ready     = !!ms?.ready;
  const docCount  = ps?.count ?? 0;
  const archive   = ms?.archive_bytes ?? 0;
  const expected  = ms?.expected_bytes ?? 82_837_504;
  const declined  = localStorage.getItem(PALACE_DECLINED_KEY) === 'true';
  const partialPct = expected > 0 ? Math.min(99, Math.round(archive * 100 / expected)) : 0;

  if (!installed) {
    card.innerHTML = `
      <h4>Semantic search <span style="color:var(--ink-3);font-size:12px;font-weight:500">not available</span></h4>
      <p style="color:var(--ink-3);font-size:13px">This build wasn't shipped with the retrieval extras (chromadb). Rebuild the sidecar with the <code>retrieval</code> extras group to enable local semantic search + RAG-style chat grounding.</p>
      <div class="kv-row"><b>Cache dir</b><span>—</span></div>
    `;
    return;
  }

  if (ready) {
    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between">
        <h4>Semantic search <span class="pill active" style="background:var(--mint-soft);color:#2E7D5B">✓ enabled</span></h4>
      </div>
      <p>Hybrid vector + BM25 search over your posts corpus. Runs fully offline — no keys, no cloud.</p>
      <div class="kv-row"><b>Indexed posts</b><span>${(docCount || 0).toLocaleString()}</span></div>
      <div class="kv-row"><b>Model</b><span>all-MiniLM-L6-v2 (384-dim, ONNX)</span></div>
      <div class="kv-row"><b>Cache</b><span title="${esc(ms?.cache_dir || '')}">${esc((ms?.cache_dir || '').split('/').slice(-3).join('/'))}</span></div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-palace-reindex">Reindex corpus</button>
      </div>
      <div id="palace-reindex-status" style="margin-top:10px;font-size:12px;color:var(--ink-3)"></div>
    `;
    card.querySelector('#btn-palace-reindex')?.addEventListener('click', () => doReindex(root));
    return;
  }

  // Not ready — either fresh install or a user who declined previously.
  const ctaLabel = declined ? 'Enable anyway' : 'Enable — 80 MB';
  const ctaClass = declined ? 'btn btn-ghost btn-sm btn-bordered' : 'btn btn-primary btn-sm';
  const resumeHint = archive > 1_000_000
    ? `<p style="color:var(--ink-3);font-size:12px;margin-top:6px">Partial download detected (${(archive/1024/1024).toFixed(1)} MB of ~80 MB) — will resume.</p>`
    : '';

  card.innerHTML = `
    <h4>Semantic search <span style="color:var(--ink-3);font-size:12px;font-weight:500">optional · 80 MB</span></h4>
    <p>Cross-topic search, "related posts" links, and smarter chat grounding — all offline after a one-time download of the embedding model (<code>all-MiniLM-L6-v2</code>, ~80 MB, cached forever).</p>
    ${resumeHint}
    <div class="palace-progress" id="palace-progress" hidden style="margin-top:10px">
      <div class="palace-bar"><div class="palace-bar-fill" id="palace-bar-fill" style="width:${partialPct}%"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--ink-3);margin-top:4px">
        <span id="palace-progress-label">Downloading…</span>
        <span id="palace-progress-pct">${partialPct}%</span>
      </div>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap" id="palace-actions">
      <button class="${ctaClass}" id="btn-palace-enable">${esc(ctaLabel)}</button>
      ${declined ? '' : `<button class="btn btn-ghost btn-sm btn-bordered" id="btn-palace-skip">Maybe later</button>`}
    </div>
    <div id="palace-error" style="margin-top:10px;font-size:12px;color:#B84747"></div>
  `;
  card.querySelector('#btn-palace-enable')?.addEventListener('click', () => startWarmup(root));
  card.querySelector('#btn-palace-skip')?.addEventListener('click', () => {
    localStorage.setItem(PALACE_DECLINED_KEY, 'true');
    // Re-render the card so the secondary Enable-anyway appears instead.
    fillPalaceCard(root, ms, ps);
  });
}

async function startWarmup(root) {
  const card = root.querySelector('#card-palace');
  if (!card) return;
  const actions = card.querySelector('#palace-actions');
  const progress = card.querySelector('#palace-progress');
  const barFill = card.querySelector('#palace-bar-fill');
  const pctEl = card.querySelector('#palace-progress-pct');
  const labelEl = card.querySelector('#palace-progress-label');
  const errEl = card.querySelector('#palace-error');

  if (actions) actions.style.display = 'none';
  if (progress) progress.hidden = false;
  if (errEl) errEl.textContent = '';

  // Subscribe BEFORE invoking so we don't miss early progress events.
  let unlistenProg, unlistenDone;
  try {
    unlistenProg = await api.onPalaceWarmupProgress(line => {
      try {
        const ev = JSON.parse(line);
        if (ev.event === 'progress') {
          const pct = Number.isFinite(ev.pct) ? ev.pct : 0;
          if (barFill) barFill.style.width = `${pct}%`;
          if (pctEl) pctEl.textContent = `${pct}%`;
          if (labelEl) labelEl.textContent = `Downloading model — ${(ev.bytes/1024/1024).toFixed(1)} MB`;
        } else if (ev.event === 'done') {
          if (barFill) barFill.style.width = '100%';
          if (pctEl) pctEl.textContent = '100%';
          if (labelEl) labelEl.textContent = 'Ready';
        } else if (ev.event === 'error') {
          if (errEl) errEl.textContent = `✗ ${ev.error}`;
        }
      } catch {}
    });
    unlistenDone = await api.onPalaceWarmupDone(async () => {
      // Cleanup + re-render the card with the fresh status.
      try { unlistenProg?.(); } catch {}
      try { unlistenDone?.(); } catch {}
      const [ms, ps] = await Promise.all([
        api.palaceModelStatus().catch(() => ({ installed: false, ready: false })),
        api.palaceStats().catch(() => ({ count: 0 })),
      ]);
      // Clear the declined flag on a successful install — user obviously
      // enabled it, don't keep showing the muted CTA next time.
      if (ms?.ready) localStorage.removeItem(PALACE_DECLINED_KEY);
      fillPalaceCard(root, ms, ps);
    });
    await api.palaceWarmup();
  } catch (e) {
    if (errEl) errEl.textContent = `✗ ${e?.message || e}`;
    try { unlistenProg?.(); } catch {}
    try { unlistenDone?.(); } catch {}
    if (actions) actions.style.display = '';
    if (progress) progress.hidden = true;
  }
}

async function doReindex(root) {
  const card = root.querySelector('#card-palace');
  const status = card?.querySelector('#palace-reindex-status');
  const btn = card?.querySelector('#btn-palace-reindex');
  if (status) status.textContent = 'Re-embedding every post — this can take a couple of minutes…';
  if (btn) btn.disabled = true;
  try {
    const r = await api.reindexPalace();
    if (status) status.textContent = `✓ upserted ${r?.upserted ?? 0} posts (skipped ${r?.skipped ?? 0}).`;
    const [ms, ps] = await Promise.all([api.palaceModelStatus(), api.palaceStats()]);
    fillPalaceCard(root, ms, ps);
  } catch (e) {
    if (status) status.textContent = `✗ ${e?.message || e}`;
    if (btn) btn.disabled = false;
  }
}

function reportError(root, section, e) {
  const err = root.querySelector('#settings-err');
  if (err) {
    err.textContent = `${err.textContent ? err.textContent + ' · ' : ''}${section}: ${e?.message || e}`;
  }
  console.warn('[settings]', section, e);
}
