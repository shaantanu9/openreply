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
        <label class="settings-toggle">
          <input type="checkbox" id="pref-dark-mode" ${localStorage.getItem('gapmap.pref.dark_mode') === 'true' ? 'checked' : ''} />
          <span><b>Dark mode</b><small>Switch the UI palette to a dark scheme. Applied instantly.</small></span>
        </label>
        <label class="settings-toggle">
          <input type="checkbox" id="pref-dense-cards" ${localStorage.getItem('gapmap.pref.dense_cards') === 'true' ? 'checked' : ''} />
          <span><b>Dense finding cards</b><small>Show only Tier-1 chips (Ulwick / triangulation / counter-evidence). Hover to see the rest.</small></span>
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

      <!-- T1.3 Trash — soft-deleted topics with restore + purge -->
      <div class="settings-card" id="card-trash">
        <h4><i data-lucide="trash-2"></i> Trash</h4>
        <p>Soft-deleted topics — recoverable for 7 days before nightly purge.</p>
        <div id="trash-list" style="margin-top:8px">Loading…</div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm btn-bordered" id="btn-trash-purge">Empty trash now (older than 7 days)</button>
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

      <!-- MCP ↔ App integration (one-click connect to any MCP client) -->
      <div class="settings-card" id="card-mcp">
        <h4><i data-lucide="plug"></i> Use with an MCP client</h4>
        <p>Connect Gap Map's MCP server to Claude Code, Claude Desktop,
        Cursor, Cline, or Windsurf — anything they scrape / fetch / ingest
        writes to <b>this app's database</b> and shows up in your topics,
        posts, and graph immediately.</p>

        <div style="display:flex;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap">
          <label style="font-size:12px;color:var(--ink-3)">Client:</label>
          <select id="mcp-client" class="select-sm" style="min-width:180px">
            <option value="">loading…</option>
          </select>
          <button class="btn btn-ghost btn-sm" id="btn-mcp-refresh" title="Re-check status">
            <i data-lucide="rotate-cw"></i>
          </button>
        </div>

        <div id="mcp-status-row" class="mcp-status-row" style="margin-top:12px">
          <span class="mcp-status-dot" data-state="loading"></span>
          <span id="mcp-status-text" style="font-size:13px">checking…</span>
        </div>

        <div id="mcp-detail" style="font-size:11.5px;color:var(--ink-3);margin-top:6px"></div>

        <div id="mcp-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn primary btn-sm" id="btn-mcp-connect" hidden><i data-lucide="link"></i> Connect</button>
          <button class="btn btn-sm btn-bordered" id="btn-mcp-resync" hidden><i data-lucide="refresh-cw"></i> Re-sync paths</button>
          <button class="btn btn-ghost btn-sm btn-bordered" id="btn-mcp-disconnect" hidden><i data-lucide="unlink"></i> Disconnect</button>
          <button class="btn btn-ghost btn-sm btn-bordered" id="btn-mcp-docs">MCP spec →</button>
        </div>

        <p style="font-size:11px;color:var(--ink-3);margin-top:10px">
          Anyone with this app installed can wire it into any MCP client —
          but they need this app to do it (token + sidecar binary).
          Token gating is plumbed but not enforced in v1.
          Restart the chosen client after Connect / Disconnect.
        </p>
      </div>

      <!-- About -->
      <div class="settings-card">
        <h4>About</h4>
        <p>Gap Map · v0.1.0 · Python sidecar + Tauri · variant-6 soft-dashboard</p>
      </div>

      <!-- ── AG-E: Advanced extractor prompts (T3.7) ───────────────────── -->
      <div class="settings-card" id="card-advanced-prompts" style="grid-column:1/-1">
        <h4><i data-lucide="sparkles"></i> Advanced: extractor prompts</h4>
        <p style="color:var(--ink-3)">
          Override the bundled YAML rubrics that drive extraction
          (painpoints, features, concepts, insights synthesis, …).
          Malformed overrides silently fall back to the bundled default.
          Not recommended unless you've read the prompt source.
        </p>
        <label class="settings-toggle" style="margin-top:6px">
          <input type="checkbox" id="pref-advanced-prompts"
            ${localStorage.getItem('gapmap.pref.advanced_prompts') === 'true' ? 'checked' : ''} />
          <span><b>I know what I'm doing</b><small>Unlocks the prompt editor below.</small></span>
        </label>
        <div id="advanced-prompts-body" hidden style="margin-top:10px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <label style="font-size:12px;color:var(--ink-3)">Prompt:</label>
            <select id="prompt-key-select" class="select-sm" style="min-width:200px">
              <option value="">loading…</option>
            </select>
            <span id="prompt-key-badge" style="font-size:11px;color:var(--ink-3)"></span>
          </div>
          <textarea id="prompt-editor" spellcheck="false"
            style="width:100%;margin-top:10px;min-height:260px;font-family:ui-monospace,Menlo,Monaco,'Courier New',monospace;font-size:12px;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--bg-1)"
            placeholder="Loading…"></textarea>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <button class="btn btn-primary btn-sm" id="btn-prompt-save">Save override</button>
            <button class="btn btn-ghost btn-sm btn-bordered" id="btn-prompt-reset">Reset to default</button>
            <span id="prompt-save-status" style="font-size:12px;color:var(--ink-3);align-self:center"></span>
          </div>
        </div>
      </div>

      <div id="settings-err" style="grid-column:1/-1;color:#B84747;font-size:12px"></div>
    </div>
  `;

  wireProfileCard(root);
  wireStaticButtons(root);
  wireAdvancedPromptsCard(root, alive);

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

  // --- MCP ↔ App integration (multi-client) ---
  // Three states (not connected / connected & aligned / connected but DB
  // drift) wired to api.mcp{Status,Install,Uninstall}, with a client picker
  // so the same flow installs into Claude Code, Cursor, Cline, Windsurf, or
  // Claude Desktop. The selected client is remembered in localStorage.
  // Spec: docs/superpowers/specs/2026-04-21-mcp-app-integration.md.
  (async () => {
    const card    = root.querySelector('#card-mcp');
    if (!card) return;
    const sel     = card.querySelector('#mcp-client');
    const btnRef  = card.querySelector('#btn-mcp-refresh');
    const txt     = card.querySelector('#mcp-status-text');
    const detail  = card.querySelector('#mcp-detail');
    const dot     = card.querySelector('.mcp-status-dot');
    const btnConn = card.querySelector('#btn-mcp-connect');
    const btnSync = card.querySelector('#btn-mcp-resync');
    const btnDis  = card.querySelector('#btn-mcp-disconnect');

    const STORAGE_KEY = 'gapmap.mcp.client';
    const clientLabels = {};   // key → human label
    const clientUrls = {       // where to go install the client when not present
      'claude-code':    'https://claude.com/claude-code',
      'claude-desktop': 'https://claude.ai/download',
      'cursor':         'https://cursor.com',
      'windsurf':       'https://windsurf.com',
      'cline':          'https://cline.bot',
    };

    const currentClient = () => sel.value || 'claude-code';

    const renderState = (s) => {
      const cl = currentClient();
      const label = clientLabels[cl] || cl;
      if (!s || s.ok === false) {
        dot.dataset.state = 'error';
        txt.textContent = s?.reason || 'unable to read status';
        detail.textContent = '';
        btnConn.hidden = true; btnSync.hidden = true; btnDis.hidden = true;
        return;
      }
      if (!s.client_present && !s.claude_present) {
        dot.dataset.state = 'warn';
        txt.textContent = `${label} not detected`;
        const url = clientUrls[cl];
        detail.innerHTML = url
          ? `Install <a href="#" id="mcp-install-client-link">${esc(label)}</a>, then come back.`
          : `Config not found at <code>${esc(s.config_path)}</code>.`;
        btnConn.hidden = true; btnSync.hidden = true; btnDis.hidden = true;
        const link = card.querySelector('#mcp-install-client-link');
        link?.addEventListener('click', e => { e.preventDefault(); api.openUrl(url); });
        return;
      }
      if (!s.connected) {
        dot.dataset.state = 'off';
        txt.textContent = `Not connected to ${label}`;
        detail.innerHTML = `Once connected, MCP tools in ${esc(label)} will write to <code>${esc(s.data_dir)}</code>.`;
        btnConn.hidden = false; btnSync.hidden = true; btnDis.hidden = true;
        return;
      }
      if (!s.db_aligned) {
        dot.dataset.state = 'warn';
        txt.textContent = `Connected to ${label} · DB mismatch`;
        detail.innerHTML =
          `${esc(label)} is reading <code>${esc(s.entry_data_dir || '?')}</code><br/>` +
          `App writes to <code>${esc(s.data_dir)}</code>. Re-sync to align.`;
        btnConn.hidden = true; btnSync.hidden = false; btnDis.hidden = false;
        return;
      }
      dot.dataset.state = 'ok';
      txt.textContent = `Connected to ${label} · DB aligned`;
      const tokenNote = s.token_in_env ? '· token saved' : '· token will refresh on Re-sync';
      detail.innerHTML =
        `Config: <code>${esc(s.config_path)}</code><br/>` +
        `Path: <code>${esc(s.data_dir)}</code> ${tokenNote}`;
      btnConn.hidden = true; btnSync.hidden = false; btnDis.hidden = false;
    };

    const refresh = async () => {
      dot.dataset.state = 'loading';
      txt.textContent = 'checking…';
      detail.textContent = '';
      try {
        const s = await api.mcpStatus(currentClient());
        renderState(s);
      } catch (e) {
        renderState({ ok: false, reason: e?.message || String(e) });
      }
    };

    const runWith = async (label, fn) => {
      btnConn.disabled = btnSync.disabled = btnDis.disabled = true;
      sel.disabled = true;
      txt.textContent = label;
      try {
        const r = await fn();
        if (r && r.ok === false) {
          renderState({ ok: false, reason: r.reason || `${label} failed` });
        } else {
          await refresh();
        }
      } catch (e) {
        renderState({ ok: false, reason: e?.message || String(e) });
      } finally {
        btnConn.disabled = btnSync.disabled = btnDis.disabled = false;
        sel.disabled = false;
      }
    };

    // Populate client dropdown from the Python-resolved list (so OS-specific
    // paths stay in one place). Mark detected ones with a ✓ in the label.
    try {
      const clients = await api.mcpClients();
      const remembered = localStorage.getItem(STORAGE_KEY) || 'claude-code';
      sel.innerHTML = '';
      for (const c of clients) {
        clientLabels[c.key] = c.label;
        const opt = document.createElement('option');
        opt.value = c.key;
        opt.textContent = `${c.present ? '✓ ' : ''}${c.label}`;
        if (c.key === remembered) opt.selected = true;
        sel.appendChild(opt);
      }
    } catch (e) {
      sel.innerHTML = '<option value="claude-code">Claude Code</option>';
    }

    sel.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEY, currentClient());
      refresh();
    });
    btnRef .addEventListener('click', refresh);
    btnConn.addEventListener('click', () => runWith('connecting…', () => api.mcpInstall(currentClient())));
    btnSync.addEventListener('click', () => runWith('re-syncing…', () => api.mcpInstall(currentClient())));
    btnDis .addEventListener('click', () => {
      const cl = currentClient();
      if (!confirm(`Disconnect Gap Map from ${clientLabels[cl] || cl}? Other MCP servers stay registered.`)) return;
      runWith('disconnecting…', () => api.mcpUninstall(cl));
    });

    refresh();
  })();

  root.querySelector('#pref-confirm-delete')?.addEventListener('change', e => {
    localStorage.setItem('gapmap.pref.confirm_delete', e.target.checked ? 'true' : 'false');
  });
  root.querySelector('#pref-dark-mode')?.addEventListener('change', e => {
    const on = e.target.checked;
    localStorage.setItem('gapmap.pref.dark_mode', on ? 'true' : 'false');
    document.documentElement.classList.toggle('dark', on);
    // Notify canvas-rendered screens (map, graph, trend charts) that
    // read CSS vars at paint time — they need a re-render to pick up
    // the new tokens since `getComputedStyle` was cached at draw time.
    try {
      window.dispatchEvent(new CustomEvent('gapmap:theme-changed', { detail: { dark: on } }));
    } catch {}
  });
  root.querySelector('#pref-dense-cards')?.addEventListener('change', e => {
    const on = e.target.checked;
    localStorage.setItem('gapmap.pref.dense_cards', on ? 'true' : 'false');
    document.documentElement.classList.toggle('dense-cards', on);
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
  // T1.3 trash card — restore / purge
  fillTrashCard(root);
  root.querySelector('#btn-trash-purge')?.addEventListener('click', async () => {
    if (!confirm('Hard-delete trashed topics older than 7 days? This cannot be undone.')) return;
    try {
      const out = await api.purgeDeletedTopics(7);
      alert(`Purged ${out?.purged || 0} topic(s).`);
      fillTrashCard(root);
    } catch (e) { alert(`Purge failed: ${e?.message || e}`); }
  });
}

async function fillTrashCard(root) {
  const host = root.querySelector('#trash-list');
  if (!host) return;
  let resp;
  try { resp = await api.listTrash(); } catch (e) { host.innerHTML = `<span class="muted">load failed: ${esc(e?.message || e)}</span>`; return; }
  const trash = resp?.trash || [];
  if (!trash.length) { host.innerHTML = `<p class="muted" style="margin:0">No topics in trash.</p>`; return; }
  host.innerHTML = trash.map(t => `
    <div class="trash-row" data-topic="${esc(t.topic)}" style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-soft,#EADFC8)">
      <span style="flex:1;font-weight:500">${esc(t.topic)}</span>
      <span class="muted" style="font-size:11.5px">${t.post_count || 0} posts · expires in ${t.expires_in_days || 0}d</span>
      <button class="btn btn-ghost btn-xs" data-action="restore">Restore</button>
    </div>
  `).join('');
  host.querySelectorAll('[data-action="restore"]').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('.trash-row');
      const topic = row.dataset.topic;
      try {
        await api.restoreTopic(topic);
        row.remove();
      } catch (e) { alert(`Restore failed: ${e?.message || e}`); }
    };
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

// ── AG-E: Advanced extractor prompts (T3.7) ────────────────────────────
//
// Gated by a localStorage flag (`gapmap.pref.advanced_prompts`) so casual
// users can't accidentally blow up their extractor rubrics. When unlocked,
// we lazy-load `api.promptList()` and populate a dropdown + textarea. Save
// writes back to the `prompt_overrides` DB table via `api.promptSet`, and
// Reset removes the override so the bundled prompt takes over again.
function wireAdvancedPromptsCard(root, alive) {
  const card = root.querySelector('#card-advanced-prompts');
  if (!card) return;
  const toggle = card.querySelector('#pref-advanced-prompts');
  const body   = card.querySelector('#advanced-prompts-body');
  const sel    = card.querySelector('#prompt-key-select');
  const editor = card.querySelector('#prompt-editor');
  const badge  = card.querySelector('#prompt-key-badge');
  const status = card.querySelector('#prompt-save-status');
  const btnSave  = card.querySelector('#btn-prompt-save');
  const btnReset = card.querySelector('#btn-prompt-reset');
  if (!toggle || !body) return;

  let listing = null;   // last-known { key: entry } from api.promptList()

  const setUnlocked = (on) => {
    body.hidden = !on;
    localStorage.setItem('gapmap.pref.advanced_prompts', on ? 'true' : 'false');
    if (on && listing == null) loadPrompts();
  };

  async function loadPrompts() {
    sel.innerHTML = '<option value="">loading…</option>';
    try {
      const r = await api.promptList();
      if (!alive || alive()) {
        listing = (r && r.prompts) || {};
        const keys = Object.keys(listing).sort();
        if (!keys.length) {
          sel.innerHTML = '<option value="">(no prompts found)</option>';
          editor.value = '';
          return;
        }
        sel.innerHTML = keys.map(k => {
          const flag = listing[k]?.has_override ? '● ' : '';
          return `<option value="${esc(k)}">${flag}${esc(k)}</option>`;
        }).join('');
        sel.value = keys[0];
        showKey(keys[0]);
      }
    } catch (e) {
      sel.innerHTML = '<option value="">error</option>';
      status.textContent = `✗ ${e?.message || e}`;
    }
  }

  function showKey(key) {
    const entry = listing && listing[key];
    if (!entry) {
      editor.value = '';
      badge.textContent = '';
      return;
    }
    editor.value = entry.has_override
      ? (entry.override_text || '')
      : (entry.bundled_text || '');
    badge.textContent = entry.has_override
      ? `override · updated ${entry.updated_at || ''}`
      : 'bundled (no override)';
    status.textContent = '';
  }

  toggle.addEventListener('change', e => setUnlocked(e.target.checked));
  sel.addEventListener('change', e => showKey(e.target.value));

  btnSave.addEventListener('click', async () => {
    const key = sel.value;
    if (!key) return;
    btnSave.disabled = true;
    status.textContent = 'saving…';
    try {
      await api.promptSet(key, editor.value || '');
      status.textContent = '✓ saved';
      await loadPrompts();
      sel.value = key;
      showKey(key);
    } catch (e) {
      status.textContent = `✗ ${e?.message || e}`;
    } finally {
      btnSave.disabled = false;
      setTimeout(() => { if (status.textContent === '✓ saved') status.textContent = ''; }, 2500);
    }
  });

  btnReset.addEventListener('click', async () => {
    const key = sel.value;
    if (!key) return;
    if (!confirm(`Reset "${key}" to the bundled default? Your override will be deleted.`)) return;
    btnReset.disabled = true;
    status.textContent = 'resetting…';
    try {
      await api.promptClear(key);
      status.textContent = '✓ reset to bundled';
      await loadPrompts();
      sel.value = key;
      showKey(key);
    } catch (e) {
      status.textContent = `✗ ${e?.message || e}`;
    } finally {
      btnReset.disabled = false;
      setTimeout(() => { if (status.textContent === '✓ reset to bundled') status.textContent = ''; }, 2500);
    }
  });

  // Initial visibility
  setUnlocked(toggle.checked);
}
