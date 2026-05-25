// Settings — renders instantly with the profile card + skeletons, then
// fills in each card as its sidecar call returns. No call blocks the UI.

import { api, esc } from '../api.js';
import { openByokModal } from './byok.js';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

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
            <p style="margin:2px 0 0;color:var(--ink-3);font-size:var(--fs-13)">${esc(profile.email || 'no email set')}</p>
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
        <h4>LLM providers <span style="color:var(--ink-3);font-size:var(--fs-13);font-weight:500">loading…</span></h4>
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

      <!-- Export destination -->
      <div class="settings-card" id="card-export-dir">
        <h4>Export destination</h4>
        <p style="color:var(--ink-3)">Choose where HTML/JSON/Markdown exports are saved.</p>
        <div class="skel skel-line" style="width:85%;margin-top:10px"></div>
      </div>

      <!-- Export destination -->
      <div class="settings-card" id="card-export-dir">
        <h4>Export destination</h4>
        <p style="color:var(--ink-3)">Choose where HTML/JSON/Markdown exports are saved.</p>
        <div class="skel skel-line" style="width:85%;margin-top:10px"></div>
      </div>

      <!-- Semantic search (palace) — opt-in on-device model download -->
      <div class="settings-card" id="card-palace">
        <h4>Semantic search <span style="color:var(--ink-3);font-size:var(--fs-13);font-weight:500">loading…</span></h4>
        <p style="color:var(--ink-3)">Checking model status…</p>
        <div class="skel skel-line" style="width:70%;margin-top:10px"></div>
      </div>

      <!-- Whisper models -->
      <div class="settings-card" id="card-whisper" style="grid-column:1/-1">
        <h4>Whisper models <span style="color:var(--ink-3);font-size:12px;font-weight:500">loading…</span></h4>
        <p style="color:var(--ink-3)">For video transcription — pull any YouTube/Vimeo/podcast URL, audio stays local.</p>
        <div id="whisper-card-body"><div class="empty-state" style="padding:12px">loading…</div></div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--line)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div>
              <div style="font-weight:600;font-size:13px">yt-dlp auto-updater</div>
              <div style="color:var(--ink-3);font-size:12px" id="ytdlp-version-line">checking…</div>
            </div>
            <button class="btn btn-ghost btn-sm btn-bordered" id="btn-ytdlp-update">Check now</button>
          </div>
        </div>
      </div>

      <!-- Tables -->
      <div class="settings-card" id="card-tables">
        <h4>Table counts</h4>
        <p>As reported by the CLI at launch</p>
        <div class="empty-state" style="padding:12px">loading…</div>
      </div>

      <!-- Command-line tool — one-click install gapmap-cli to /usr/local/bin/gapmap -->
      <div class="settings-card" id="card-cli-symlink" style="grid-column:1/-1">
        <h4>Command line tool</h4>
        <p style="color:var(--ink-3)">
          Use Gap Map from your terminal: <code>gapmap research collect --topic "X"</code>,
          <code>gapmap query "SELECT …"</code>, etc. Installing creates a symlink at
          <code>/usr/local/bin/gapmap</code> pointing at the bundled binary (a future app
          update is picked up automatically). macOS will prompt for your password once.
        </p>
        <div id="cli-symlink-body" style="margin-top:10px">
          <div class="empty-state" style="padding:10px">checking…</div>
        </div>
      </div>

      <!-- Task 9.5 — Extraction mode + token-cost controls.
           Persisted to ~/Library/Application Support/…/extraction.json via
           the extraction_prefs_{get,set} Rust commands. Per-topic overrides
           live in topic_prefs; the Settings pane only writes globals. -->
      <div class="settings-card" id="card-extraction">
        <h4><i data-lucide="gauge"></i> Extraction <span style="color:var(--ink-3);font-size:12px;font-weight:500" id="extraction-head-note">loading…</span></h4>
        <p style="color:var(--ink-3)">When the worker runs and how aggressively it spends tokens. Topics can override these individually from their own page.</p>
        <div id="extraction-body" style="margin-top:10px"><div class="skel skel-line" style="width:60%"></div></div>
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
          <span id="schedule-status-text" style="font-size:var(--fs-13);color:var(--ink-3)">…</span>
        </div>
        <p style="font-size:var(--fs-11);color:var(--ink-3);margin-top:8px">
          Only topics you toggle on (from their page) will be refreshed. Logs go to
          <code>~/Library/Application Support/com.shantanu.gapmap/gapmap/schedule.log</code>.
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
          <label style="font-size:var(--fs-13);color:var(--ink-3)">Client:</label>
          <select id="mcp-client" class="select-sm" style="min-width:180px">
            <option value="">loading…</option>
          </select>
          <button class="btn btn-ghost btn-sm" id="btn-mcp-refresh" title="Re-check status">
            <i data-lucide="rotate-cw"></i>
          </button>
        </div>

        <div id="mcp-status-row" class="mcp-status-row" style="margin-top:12px">
          <span class="mcp-status-dot" data-state="loading"></span>
          <span id="mcp-status-text" style="font-size:var(--fs-13)">checking…</span>
        </div>

        <div id="mcp-detail" style="font-size:var(--fs-11);color:var(--ink-3);margin-top:6px"></div>

        <div id="mcp-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn primary btn-sm" id="btn-mcp-connect" hidden><i data-lucide="link"></i> Connect</button>
          <button class="btn btn-sm btn-bordered" id="btn-mcp-resync" hidden><i data-lucide="refresh-cw"></i> Re-sync paths</button>
          <button class="btn btn-ghost btn-sm btn-bordered" id="btn-mcp-disconnect" hidden><i data-lucide="unlink"></i> Disconnect</button>
          <button class="btn btn-ghost btn-sm btn-bordered" id="btn-mcp-docs">MCP spec →</button>
        </div>

        <p style="font-size:var(--fs-11);color:var(--ink-3);margin-top:10px">
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
            <label style="font-size:var(--fs-13);color:var(--ink-3)">Prompt:</label>
            <select id="prompt-key-select" class="select-sm" style="min-width:200px">
              <option value="">loading…</option>
            </select>
            <span id="prompt-key-badge" style="font-size:var(--fs-11);color:var(--ink-3)"></span>
          </div>
          <textarea id="prompt-editor" spellcheck="false"
            style="width:100%;margin-top:10px;min-height:260px;font-family:ui-monospace,Menlo,Monaco,'Courier New',monospace;font-size:var(--fs-13);padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--bg-1)"
            placeholder="Loading…"></textarea>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <button class="btn btn-primary btn-sm" id="btn-prompt-save">Save override</button>
            <button class="btn btn-ghost btn-sm btn-bordered" id="btn-prompt-reset">Reset to default</button>
            <span id="prompt-save-status" style="font-size:var(--fs-13);color:var(--ink-3);align-self:center"></span>
          </div>
        </div>
      </div>

      <div id="settings-err" style="grid-column:1/-1;color:#B84747;font-size:var(--fs-13)"></div>
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

  // CLI symlink status — separate Settings card with Install/Uninstall buttons
  api.cliSymlinkStatus()
    .then(s => { if (alive()) fillCliSymlinkCard(root, s); })
    .catch(e => { if (alive()) fillCliSymlinkCard(root, { error: String(e?.message || e) }); });

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

  api.exportPrefsGet()
    .then(prefs => { if (alive()) fillExportCard(root, prefs); })
    .catch(e => { if (alive()) reportError(root, 'export', e); });

  api.exportPrefsGet()
    .then(prefs => { if (alive()) fillExportCard(root, prefs); })
    .catch(e => { if (alive()) reportError(root, 'export', e); });

  // Task 9.5 — Extraction pane. Loads global prefs + today's token spend
  // in parallel; renders the mode radios / sliders / cap input / cost
  // estimator as soon as both land. Individual Save clicks invoke
  // extractionPrefsSet({global}) and re-render the cost line in place.
  Promise.all([
    api.extractionPrefsGet(null).catch(() => null),
    api.todayTokenSpend().catch(() => null),
    api.byokStatus().catch(() => null),
    api.runQuery(
      "SELECT COALESCE(sum(1),0) AS n FROM extraction_queue"
    ).catch(() => null),
  ])
    .then(([prefs, spend, byok, qRows]) => {
      if (alive()) fillExtractionCard(root, prefs, spend, byok, qRows);
    })
    .catch(e => { if (alive()) reportError(root, 'extraction', e); });

  // Palace / semantic-search card. Pull status + current doc count in
  // parallel, then render the right state (not-installed | not-ready |
  // ready).
  Promise.all([
    api.palaceModelStatus().catch(() => ({ installed: false, ready: false })),
    api.palaceStats().catch(() => ({ ok: false, count: 0 })),
  ])
    .then(([ms, ps]) => { if (alive()) fillPalaceCard(root, ms, ps); })
    .catch(e => { if (alive()) reportError(root, 'palace', e); });

  // Whisper card — catalogue drives the installed/available table; yt-dlp
  // version line below it shows the overlay status.
  Promise.all([
    api.whisperCatalogue().catch(() => []),
    api.ytdlpVersion().catch(() => ({ installed: '—', latest: '—' })),
  ])
    .then(([cat, ver]) => { if (alive()) fillWhisperCard(root, cat, ver); })
    .catch(e => { if (alive()) reportError(root, 'whisper', e); });
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
    const activationHintId = 'mcp-activation-gate-note';

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

    // Per-reason messaging for the MCP activation gate. Kept in sync with
    // the Rust reason codes in commands.rs::compute_activation_reason.
    // Every case has an actionable primary button so the user never sees
    // a dead-end "locked" state.
    const GATE_COPY = {
      not_activated: {
        badge: 'Not activated',
        heading: 'MCP is locked until this device is activated',
        body: 'Activate your licence key on this device to unlock MCP for Claude Code, Claude Desktop, Cursor, Windsurf, or Cline.',
        action: { label: 'Activate this device', href: '#/activate' },
      },
      device_mismatch: {
        badge: 'Different device',
        heading: 'Stored licence is for a different device',
        body: 'Your licence is bound to another machine. Re-activate this device (free within your device slot limit) to move the licence here.',
        action: { label: 'Re-activate this device', href: '#/activate' },
      },
      token_missing: {
        badge: 'Token missing',
        heading: 'Activation token is missing from the keychain',
        body: 'The saved token blob was removed or corrupted. Re-activate this device to refresh it — no new purchase needed.',
        action: { label: 'Refresh activation', href: '#/activate' },
      },
      expired: {
        badge: 'Expired',
        heading: 'Licence expired',
        body: 'Your licence term ended. Open the customer portal from Activate → Purchase history to renew, then re-activate this device to resume MCP.',
        action: { label: 'Renew & re-activate', href: '#/activate' },
      },
      token_device_mismatch: {
        badge: 'Device fingerprint changed',
        heading: 'Activation token no longer matches this device',
        body: 'Something about this machine changed (hostname, hardware, or OS). Re-activate this device to refresh the token.',
        action: { label: 'Re-activate this device', href: '#/activate' },
      },
      unknown: {
        badge: 'Locked',
        heading: 'MCP is locked until this device is activated',
        body: 'Complete activation in onboarding or Settings → Licence to unlock MCP client setup.',
        action: { label: 'Go to activation', href: '#/activate' },
      },
    };

    const renderActivationGate = (reasonCode = 'not_activated', reasonMsg = '') => {
      const copy = GATE_COPY[reasonCode] || GATE_COPY.unknown;
      let gate = card.querySelector(`#${activationHintId}`);
      if (!gate) {
        gate = document.createElement('div');
        gate.id = activationHintId;
        gate.style.marginTop = '8px';
        gate.style.padding = '10px 12px';
        gate.style.border = '1px solid var(--line)';
        gate.style.borderRadius = '8px';
        gate.style.background = 'var(--surface)';
        gate.style.fontSize = '12px';
        gate.style.color = 'var(--ink-2)';
        const detailHost = card.querySelector('#mcp-detail');
        detailHost?.parentElement?.appendChild(gate);
      }
      // Detail message from backend wins when present — the Rust gate passes
      // a precise, already-formatted reason (e.g. with expiry date) that the
      // static `body` copy can't know. Fall through to `copy.body` if empty.
      const detailedBody = reasonMsg && reasonMsg.trim() ? esc(reasonMsg.trim()) : esc(copy.body);
      gate.innerHTML =
        `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
           <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:var(--orange-soft,#ffe9d6);color:#b85a1e;font-weight:600;font-size:11px">
             ⚠ ${esc(copy.badge)}
           </span>
           <span style="font-weight:600;color:var(--ink);font-size:13px">${esc(copy.heading)}</span>
         </div>
         <div style="margin-bottom:8px">${detailedBody}</div>
         <a href="${copy.action.href}" class="btn btn-sm primary" id="mcp-gate-cta" style="text-decoration:none">${esc(copy.action.label)} →</a>`;
      dot.dataset.state = 'warn';
      txt.textContent = copy.heading;
      detail.textContent = '';
      sel.disabled = true;
      btnRef.disabled = true;
      btnConn.hidden = true; btnSync.hidden = true; btnDis.hidden = true;
    };

    // Best-effort extraction of `[mcp:<code>]` prefix the Rust gate emits.
    // Returns `null` if the error doesn't match the schema so the caller can
    // fall through to generic handling.
    const parseMcpReason = (err) => {
      const msg = err?.message || (typeof err === 'string' ? err : String(err || ''));
      const m = msg.match(/\[mcp:([a-z_]+)\]\s*(.*)/i);
      if (!m) return null;
      return { reason_code: m[1], reason: m[2] || '' };
    };

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
      // Pre-2026-04-24 installs don't have MCP_TAKEOVER_STALE_LOCK=1 in the
      // entry env, so a client restart can hit `another_mcp_server_running`
      // until the user manually deletes the pid file. One click to re-sync
      // rewrites the entry with the flag and the problem stops recurring.
      if (s.takeover_configured === false) {
        dot.dataset.state = 'warn';
        txt.textContent = `Connected to ${label} · needs re-sync`;
        detail.innerHTML =
          `This entry predates stale-lock auto-recovery. A client restart can hit ` +
          `<code>another_mcp_server_running</code> until you re-sync. One click fixes it.`;
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
      // 12s safety timeout — Python sidecar cold-start on a freshly
      // signed dev binary can take ~5-8s, well within bounds. Without
      // this, a wedged sidecar (DB lock, frozen Ollama callback at
      // import time, gatekeeper verification stall) leaves the card
      // permanently in "checking…". Surfacing the timeout as an
      // actionable error lets the user click Refresh / Re-sync.
      const TIMEOUT_MS = 12000;
      const timeoutPromise = new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`mcp_status timed out after ${TIMEOUT_MS}ms — sidecar may be stuck`)), TIMEOUT_MS)
      );
      try {
        const s = await Promise.race([api.mcpStatus(currentClient()), timeoutPromise]);
        renderState(s);
      } catch (e) {
        // A licence that was valid at page load can flip to expired/mismatch
        // while the card is open (manual deactivate from the web portal,
        // clock change, etc). If the error has the `[mcp:<code>]` prefix
        // from `ensure_mcp_allowed`, re-render the activation gate with
        // the specific reason instead of a raw "unable to read status".
        const gate = parseMcpReason(e);
        if (gate) {
          renderActivationGate(gate.reason_code, gate.reason);
        } else {
          renderState({ ok: false, reason: e?.message || String(e) });
        }
      }
    };

    const runWith = async (label, fn) => {
      btnConn.disabled = btnSync.disabled = btnDis.disabled = true;
      sel.disabled = true;
      txt.textContent = label;
      try {
        const r = await fn();
        if (r && r.ok === false) {
          // Backend returned structured `{ok:false, reason}` — prefer that
          // but still parse for an `[mcp:<code>]` prefix in case the
          // Python install helper propagates the Rust gate error verbatim.
          const gate = parseMcpReason({ message: r.reason });
          if (gate) {
            renderActivationGate(gate.reason_code, gate.reason);
          } else {
            renderState({ ok: false, reason: r.reason || `${label} failed` });
          }
        } else {
          await refresh();
        }
      } catch (e) {
        const gate = parseMcpReason(e);
        if (gate) {
          renderActivationGate(gate.reason_code, gate.reason);
        } else {
          renderState({ ok: false, reason: e?.message || String(e) });
        }
      } finally {
        btnConn.disabled = btnSync.disabled = btnDis.disabled = false;
        sel.disabled = false;
      }
    };

    // MCP is activation-gated at backend too; mirror it here for clear UX.
    // `license_status` returns reason_code + reason when not activated, so
    // we can render the exact case (expired / device_mismatch / etc) and
    // guide the user to the right recovery path.
    try {
      const lic = await api.licenseStatus();
      if (!lic?.activated) {
        renderActivationGate(lic?.reason_code || 'not_activated', lic?.reason || '');
        return;
      }
    } catch (e) {
      // If we can't even probe the license status, behave as first-time user.
      renderActivationGate('not_activated', e?.message || '');
      return;
    }

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
      <span class="muted" style="font-size:var(--fs-11)">${t.post_count || 0} posts · expires in ${t.expires_in_days || 0}d</span>
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
    <h4>LLM providers <span style="color:var(--ink-3);font-size:var(--fs-13);font-weight:500">${readyCount} ready</span></h4>
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

function fillExportCard(root, prefs) {
  const card = root.querySelector('#card-export-dir');
  if (!card) return;
  const effectiveDir = prefs?.effective_dir || prefs?.default_dir || '—';
  const configuredDir = (prefs?.configured_dir || '').trim();
  const isCustom = !!prefs?.is_custom && configuredDir;
  card.innerHTML = `
    <h4>Export destination <span style="color:var(--ink-3);font-size:12px;font-weight:500">${isCustom ? 'custom' : 'default'}</span></h4>
    <p style="color:var(--ink-3)">All exports from topic/report screens save here.</p>
    <div class="kv-row"><b>Current folder</b><span title="${esc(effectiveDir)}">${esc(effectiveDir)}</span></div>
    ${isCustom ? `<div class="kv-row"><b>Custom override</b><span title="${esc(configuredDir)}">${esc(configuredDir)}</span></div>` : ''}
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" id="btn-export-dir-pick">Choose folder</button>
      <button class="btn btn-ghost btn-sm btn-bordered" id="btn-export-dir-reveal">Reveal</button>
      <button class="btn btn-ghost btn-sm btn-bordered" id="btn-export-dir-reset" ${isCustom ? '' : 'disabled'}>Use app default</button>
    </div>
    <div id="export-dir-status" style="margin-top:8px;font-size:12px;color:var(--ink-3)"></div>
  `;

  const statusEl = card.querySelector('#export-dir-status');
  const setStatus = (txt, ok = false) => {
    if (!statusEl) return;
    statusEl.textContent = txt;
    statusEl.style.color = ok ? '#2E7D5B' : 'var(--ink-3)';
  };

  card.querySelector('#btn-export-dir-reveal')?.addEventListener('click', () => {
    api.revealInFinder(effectiveDir);
  });

  card.querySelector('#btn-export-dir-pick')?.addEventListener('click', async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: effectiveDir,
        title: 'Choose export folder',
      });
      if (!selected || typeof selected !== 'string') return;
      setStatus('Saving...');
      const next = await api.exportPrefsSet(selected);
      fillExportCard(root, next);
      setStatus('Saved export folder.', true);
    } catch (e) {
      setStatus(`Failed: ${e?.message || e}`);
    }
  });

  card.querySelector('#btn-export-dir-reset')?.addEventListener('click', async () => {
    try {
      setStatus('Resetting...');
      const next = await api.exportPrefsSet(null);
      fillExportCard(root, next);
      setStatus('Using app default folder now.', true);
    } catch (e) {
      setStatus(`Failed: ${e?.message || e}`);
    }
  });
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

// ─── Command-line tool symlink card ─────────────────────────────────────────
// Three visible states:
//   1. error          — backend command failed (osascript missing, etc.)
//   2. not installed  — `Install command line tool` button
//   3. installed      — green badge + path + "Uninstall" + "Re-install" buttons
//      (re-install is for when the bundled binary has moved, e.g. app update
//      copied the .app to a different location)
function fillCliSymlinkCard(root, status) {
  const body = root.querySelector('#cli-symlink-body');
  if (!body) return;

  const renderBusy = (msg) => {
    body.innerHTML = `<div class="empty-state" style="padding:10px">${esc(msg)}</div>`;
  };

  const refresh = async () => {
    try {
      const next = await api.cliSymlinkStatus();
      fillCliSymlinkCard(root, next);
    } catch (e) {
      fillCliSymlinkCard(root, { error: String(e?.message || e) });
    }
  };

  if (status?.error) {
    body.innerHTML = `
      <div class="empty-state" style="padding:10px;color:var(--rose,#c33)">
        Could not check CLI install state: ${esc(status.error)}
      </div>`;
    return;
  }

  const installed = !!status?.installed;
  const healthy = !!status?.healthy;
  const path = esc(status?.path || '/usr/local/bin/gapmap');
  const pointsTo = esc(status?.points_to || '');
  const expected = esc(status?.expected || '');

  if (!installed) {
    body.innerHTML = `
      <div class="kv-row"><b>Status</b><span style="color:var(--ink-3)">Not installed</span></div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm icon-btn" id="cli-install">
          <i data-lucide="download"></i> Install command line tool
        </button>
      </div>
      <div style="color:var(--ink-3);font-size:12px;margin-top:8px">
        Creates a symlink at <code>${path}</code> pointing at the bundled binary.
      </div>`;
    body.querySelector('#cli-install').addEventListener('click', async () => {
      renderBusy('Requesting admin password…');
      try {
        const res = await api.installCliSymlink();
        renderBusy(res?.message || 'Installed. Verifying…');
        await refresh();
      } catch (e) {
        body.innerHTML = `
          <div class="empty-state" style="padding:10px;color:var(--rose,#c33)">
            ${esc(String(e?.message || e))}
          </div>
          <div style="margin-top:8px"><button class="btn btn-ghost btn-sm" id="cli-retry">Try again</button></div>`;
        body.querySelector('#cli-retry').addEventListener('click', refresh);
      }
    });
    window.refreshIcons?.();
    return;
  }

  // Installed — show health, path details, uninstall
  const healthBadge = healthy
    ? `<span style="color:var(--mint,#2a8); font-weight:600">Healthy</span>`
    : `<span style="color:var(--gold,#c80); font-weight:600">Stale — re-install</span>`;
  body.innerHTML = `
    <div class="kv-row"><b>Status</b><span>${healthBadge}</span></div>
    <div class="kv-row"><b>Installed at</b><span><code>${path}</code></span></div>
    <div class="kv-row"><b>Points to</b><span><code style="word-break:break-all">${pointsTo}</code></span></div>
    ${healthy ? '' : `
      <div class="kv-row"><b>Expected</b><span><code style="word-break:break-all">${expected}</code></span></div>`}
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      ${!healthy ? `
        <button class="btn btn-primary btn-sm icon-btn" id="cli-reinstall">
          <i data-lucide="refresh-cw"></i> Re-install to current binary
        </button>` : ''}
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="cli-uninstall">
        <i data-lucide="trash-2"></i> Uninstall
      </button>
      <button class="btn btn-ghost btn-sm" id="cli-test">Try in terminal</button>
    </div>
    <div style="color:var(--ink-3);font-size:12px;margin-top:8px">
      Run <code>${path} --help</code> in your terminal to verify.
    </div>`;
  body.querySelector('#cli-uninstall').addEventListener('click', async () => {
    if (!confirm(`Remove ${status.path}? You can re-install any time.`)) return;
    renderBusy('Requesting admin password…');
    try {
      await api.uninstallCliSymlink();
      await refresh();
    } catch (e) {
      body.innerHTML = `
        <div class="empty-state" style="padding:10px;color:var(--rose,#c33)">
          ${esc(String(e?.message || e))}
        </div>`;
    }
  });
  const reBtn = body.querySelector('#cli-reinstall');
  if (reBtn) reBtn.addEventListener('click', async () => {
    renderBusy('Requesting admin password…');
    try {
      await api.installCliSymlink();
      await refresh();
    } catch (e) {
      body.innerHTML = `
        <div class="empty-state" style="padding:10px;color:var(--rose,#c33)">
          ${esc(String(e?.message || e))}
        </div>`;
    }
  });
  const testBtn = body.querySelector('#cli-test');
  if (testBtn) testBtn.addEventListener('click', () => {
    // Best UX would be to open Terminal.app pre-typed. Without that capability
    // here, give the user the exact line to copy.
    navigator.clipboard?.writeText(`${status.path} --help`).catch(() => {});
    testBtn.textContent = 'Copied — paste in terminal';
    setTimeout(() => { testBtn.textContent = 'Try in terminal'; }, 2000);
  });
  window.refreshIcons?.();
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
      <h4>Semantic search <span style="color:var(--ink-3);font-size:var(--fs-13);font-weight:500">not available</span></h4>
      <p style="color:var(--ink-3);font-size:var(--fs-13)">This build wasn't shipped with the retrieval extras (chromadb). Rebuild the sidecar with the <code>retrieval</code> extras group to enable local semantic search + RAG-style chat grounding.</p>
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
      <div id="palace-reindex-status" style="margin-top:10px;font-size:var(--fs-13);color:var(--ink-3)"></div>
    `;
    card.querySelector('#btn-palace-reindex')?.addEventListener('click', () => doReindex(root));
    return;
  }

  // Not ready — either fresh install or a user who declined previously.
  const ctaLabel = declined ? 'Enable anyway' : 'Enable — 80 MB';
  const ctaClass = declined ? 'btn btn-ghost btn-sm btn-bordered' : 'btn btn-primary btn-sm';
  const resumeHint = archive > 1_000_000
    ? `<p style="color:var(--ink-3);font-size:var(--fs-13);margin-top:6px">Partial download detected (${(archive/1024/1024).toFixed(1)} MB of ~80 MB) — will resume.</p>`
    : '';

  card.innerHTML = `
    <h4>Semantic search <span style="color:var(--ink-3);font-size:var(--fs-13);font-weight:500">optional · 80 MB</span></h4>
    <p>Cross-topic search, "related posts" links, and smarter chat grounding — all offline after a one-time download of the embedding model (<code>all-MiniLM-L6-v2</code>, ~80 MB, cached forever).</p>
    ${resumeHint}
    <div class="palace-progress" id="palace-progress" hidden style="margin-top:10px">
      <div class="palace-bar"><div class="palace-bar-fill" id="palace-bar-fill" style="width:${partialPct}%"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:var(--fs-11);color:var(--ink-3);margin-top:4px">
        <span id="palace-progress-label">Downloading…</span>
        <span id="palace-progress-pct">${partialPct}%</span>
      </div>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap" id="palace-actions">
      <button class="${ctaClass}" id="btn-palace-enable">${esc(ctaLabel)}</button>
      ${declined ? '' : `<button class="btn btn-ghost btn-sm btn-bordered" id="btn-palace-skip">Maybe later</button>`}
    </div>
    <div id="palace-error" style="margin-top:10px;font-size:var(--fs-13);color:#B84747"></div>
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

// ── Task 9.5: Extraction pane (mode / threshold / batch / cap / idle-release / cost) ──
//
// Reads the 3-tier resolved prefs from `extraction_prefs_get(null)` (no
// topic) + today's token spend + BYOK for provider-label rendering. Writes
// go through `extractionPrefsSet('global', {...})`; each slider commits on
// `input` with a 400ms debounce so the user sees the cost estimator refresh
// as they drag.
//
// Spec: docs/superpowers/specs/2026-04-21-incremental-enrichment-design.md §12.
const EXTRACTION_MODES = [
  { key: 'auto',      label: 'Auto',      hint: 'Worker drains queue as soon as a topic crosses the threshold.' },
  { key: 'manual',    label: 'Manual',    hint: 'Nothing runs until you click "Extract now" on a topic.' },
  { key: 'scheduled', label: 'Scheduled', hint: 'Worker only runs during the window below.' },
];

// Rough per-batch prompt+response size. Varies by extractor — averaged
// across the 4 (painpoints/features/complaints/diy) from production logs.
const EXTRACT_TOKENS_PER_BATCH_POST = 350;

function _fmtUsd(n) {
  if (!Number.isFinite(n)) return '$0.00';
  if (n < 0.01) return '< $0.01';
  if (n < 1)   return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function _providerLabel(byok) {
  const key = byok?.llm_provider || '';
  return LLM_LABELS[key] || key || 'auto-detect';
}

function _estimateCost(queued, effective, byok) {
  // Rough: (queued / batch_size) × tokens_per_batch × price/1M.
  const batch = Math.max(1, Number(effective?.batch_size) || 5);
  const nBatches = Math.ceil((queued || 0) / batch);
  const tokens = nBatches * Math.max(batch, 1) * EXTRACT_TOKENS_PER_BATCH_POST;
  const provider = (byok?.llm_provider || '').toLowerCase();
  // Price per 1M tokens, using the same table the Python side uses. Kept
  // intentionally small — users tweak providers often; this lives in JS
  // for responsiveness and is only ever indicative.
  const PRICE_PER_1M = {
    'anthropic':  3.0,
    'openai':     0.8,
    'openrouter': 0.15,
    'groq':       0.6,
    'deepseek':   0.5,
    'mistral':    1.0,
    'google':     0.3,
    'ollama':     0.0,
    '':           0.15,
  };
  const rate = PRICE_PER_1M[provider] ?? 0.15;
  const usd = (tokens * rate) / 1_000_000;
  return { tokens, usd, provider: provider || 'auto', nBatches };
}

function fillExtractionCard(root, prefs, spend, byok, queuedRows) {
  const card = root.querySelector('#card-extraction');
  const body = card?.querySelector('#extraction-body');
  const head = card?.querySelector('#extraction-head-note');
  if (!card || !body) return;

  const effective = prefs?.effective || prefs?.global || {};
  const mode = (effective.mode || 'auto').toLowerCase();
  const threshold = Number(effective.threshold) || 100;
  const batchSize = Number(effective.batch_size) || 5;
  const winStart = effective.window_start || '23:00';
  const winEnd   = effective.window_end   || '06:00';
  const capVal   = effective.daily_token_cap;
  const capSet   = capVal != null && capVal !== '' && Number(capVal) > 0;
  const idleRel  = !!effective.release_llm_idle;

  const queuedN = Array.isArray(queuedRows) && queuedRows[0]?.n || 0;
  const est = _estimateCost(queuedN, effective, byok);
  const providerLabel = _providerLabel(byok);

  const todayUsd = Number(spend?.est_usd || 0);
  const todayIn  = Number(spend?.tokens_in || 0);
  const todayOut = Number(spend?.tokens_out || 0);

  if (head) head.textContent = `mode: ${mode}`;
  body.innerHTML = `
    <div class="extract-modes" id="extract-modes" style="display:flex;gap:8px;flex-wrap:wrap">
      ${EXTRACTION_MODES.map(m => `
        <label class="extract-mode-chip ${mode === m.key ? 'on' : ''}" data-mode="${m.key}"
          style="flex:1;min-width:150px;border:1px solid ${mode === m.key ? 'var(--accent,#FF8C42)' : 'var(--line)'};border-radius:8px;padding:8px 10px;cursor:pointer;display:flex;gap:8px;align-items:flex-start">
          <input type="radio" name="extraction-mode" value="${m.key}" ${mode === m.key ? 'checked' : ''}
            style="margin-top:3px" />
          <span>
            <b style="display:block;font-size:13px">${esc(m.label)}</b>
            <span style="color:var(--ink-3);font-size:11.5px">${esc(m.hint)}</span>
          </span>
        </label>
      `).join('')}
    </div>

    <div id="extract-schedule" ${mode === 'scheduled' ? '' : 'hidden'}
         style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap">
      <label style="display:flex;gap:6px;align-items:center;font-size:12.5px">
        <span>Window start</span>
        <input type="time" id="extract-win-start" value="${esc(winStart)}" />
      </label>
      <label style="display:flex;gap:6px;align-items:center;font-size:12.5px">
        <span>end</span>
        <input type="time" id="extract-win-end"   value="${esc(winEnd)}" />
      </label>
      <span style="color:var(--ink-3);font-size:11.5px">Overnight windows (23:00 → 06:00) are supported.</span>
    </div>

    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;margin-top:14px">
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px">
        <span>Post threshold (<b id="extract-threshold-val">${threshold}</b> posts)</span>
        <input type="range" id="extract-threshold" min="50" max="500" step="10" value="${threshold}" />
        <small style="color:var(--ink-3)">Below this, the worker stays asleep for a topic.</small>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px">
        <span>Batch size (<b id="extract-batch-val">${batchSize}</b> posts per LLM call)</span>
        <input type="range" id="extract-batch" min="1" max="20" step="1" value="${batchSize}" />
        <small style="color:var(--ink-3)">Larger = cheaper per post, higher peak RAM.</small>
      </label>
    </div>

    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:14px">
      <label style="display:flex;gap:6px;align-items:center;font-size:12.5px">
        <input type="checkbox" id="extract-cap-enabled" ${capSet ? 'checked' : ''} />
        <span>Daily token cap</span>
      </label>
      <input type="number" id="extract-cap-value" min="1000" step="1000"
             value="${capSet ? Number(capVal) : 100000}"
             ${capSet ? '' : 'disabled'}
             style="width:120px" />
      <span style="color:var(--ink-3);font-size:11.5px" id="extract-cap-note">
        ${capSet ? `Pauses when spent ≥ cap. Today: ${todayIn + todayOut} tokens.` : 'No limit (default).'}
      </span>
    </div>

    <label class="settings-toggle" style="margin-top:10px">
      <input type="checkbox" id="extract-idle-release" ${idleRel ? 'checked' : ''} />
      <span>
        <b>Release LLM when idle</b>
        <small>Sends <code>keep_alive=0</code> to Ollama after 10 min idle so it unloads. Cloud providers ignore this. Also controlled by <code>GAPMAP_RELEASE_LLM_IDLE</code>.</small>
      </span>
    </label>

    <div id="extract-cost" style="margin-top:14px;padding:10px 12px;border-radius:6px;background:var(--bg-1);border:1px solid var(--line);font-size:12.5px;line-height:1.5">
      <div id="extract-cost-estimate">${_formatCostLine(queuedN, est, providerLabel)}</div>
      <div style="color:var(--ink-3);margin-top:4px">
        Today’s spend: <b>${todayIn.toLocaleString()} in · ${todayOut.toLocaleString()} out · ${esc(_fmtUsd(todayUsd))}</b>
        ${(spend?.breakdown || []).length
          ? ` — <span style="color:var(--ink-3)">${(spend.breakdown || []).map(r => `${esc(r.provider || '?')}/${esc(r.model || '?')}: ${esc(_fmtUsd(Number(r.est_usd) || 0))}`).join(' · ')}</span>`
          : ''}
      </div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-primary btn-sm" id="extract-save">Save defaults</button>
      <span id="extract-save-status" style="font-size:12px;color:var(--ink-3);align-self:center"></span>
    </div>
  `;
  window.refreshIcons?.();

  // Local mutable state so "Save defaults" only writes one shape.
  let pending = {
    mode,
    threshold,
    batch_size: batchSize,
    window_start: winStart,
    window_end: winEnd,
    daily_token_cap: capSet ? Number(capVal) : null,
    release_llm_idle: idleRel,
  };

  const refreshCostLine = () => {
    const est2 = _estimateCost(queuedN, pending, byok);
    const el = card.querySelector('#extract-cost-estimate');
    if (el) el.innerHTML = _formatCostLine(queuedN, est2, providerLabel);
  };

  card.querySelectorAll('input[name="extraction-mode"]').forEach(r => {
    r.addEventListener('change', e => {
      pending.mode = e.target.value;
      card.querySelectorAll('.extract-mode-chip').forEach(c =>
        c.classList.toggle('on', c.dataset.mode === pending.mode));
      const sch = card.querySelector('#extract-schedule');
      if (sch) sch.hidden = pending.mode !== 'scheduled';
      if (head) head.textContent = `mode: ${pending.mode}`;
    });
  });

  const thresholdInput = card.querySelector('#extract-threshold');
  const thresholdVal   = card.querySelector('#extract-threshold-val');
  thresholdInput?.addEventListener('input', e => {
    pending.threshold = Number(e.target.value);
    if (thresholdVal) thresholdVal.textContent = pending.threshold;
    refreshCostLine();
  });

  const batchInput = card.querySelector('#extract-batch');
  const batchVal   = card.querySelector('#extract-batch-val');
  batchInput?.addEventListener('input', e => {
    pending.batch_size = Number(e.target.value);
    if (batchVal) batchVal.textContent = pending.batch_size;
    refreshCostLine();
  });

  const winS = card.querySelector('#extract-win-start');
  const winE = card.querySelector('#extract-win-end');
  winS?.addEventListener('change', e => { pending.window_start = e.target.value; });
  winE?.addEventListener('change', e => { pending.window_end   = e.target.value; });

  const capEn  = card.querySelector('#extract-cap-enabled');
  const capVal2 = card.querySelector('#extract-cap-value');
  capEn?.addEventListener('change', e => {
    const on = e.target.checked;
    if (capVal2) capVal2.disabled = !on;
    pending.daily_token_cap = on ? Number(capVal2?.value) || 100000 : null;
  });
  capVal2?.addEventListener('input', e => {
    const n = Number(e.target.value);
    pending.daily_token_cap = n > 0 ? n : null;
  });

  const idle = card.querySelector('#extract-idle-release');
  idle?.addEventListener('change', e => { pending.release_llm_idle = !!e.target.checked; });

  card.querySelector('#extract-save')?.addEventListener('click', async () => {
    const btn = card.querySelector('#extract-save');
    const status = card.querySelector('#extract-save-status');
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'saving…';
    try {
      await api.extractionPrefsSet('global', pending);
      if (status) { status.textContent = '✓ saved'; status.style.color = '#2E7D5B'; }
      setTimeout(() => { if (status && status.textContent === '✓ saved') status.textContent = ''; }, 2500);
      // Notify open topic pages so their override row picks up the new defaults.
      window.dispatchEvent(new CustomEvent('gapmap:changed', { detail: { kind: 'extraction_prefs' } }));
    } catch (e) {
      if (status) { status.textContent = `✗ ${e?.message || e}`; status.style.color = '#B84747'; }
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function _formatCostLine(queuedN, est, providerLabel) {
  if (!queuedN) {
    return `Queue is empty — nothing pending to extract. Provider: <b>${esc(providerLabel)}</b>.`;
  }
  const tokens = est.tokens.toLocaleString();
  const usd = _fmtUsd(est.usd);
  if (est.provider === 'ollama') {
    return `Estimated cost to extract queue: <b>${queuedN.toLocaleString()}</b> posts × ~${EXTRACT_TOKENS_PER_BATCH_POST} tokens/batch = <b>$0</b> (Ollama — local, free).`;
  }
  return `Estimated cost to extract queue: <b>${queuedN.toLocaleString()}</b> posts × ~${EXTRACT_TOKENS_PER_BATCH_POST} tokens/batch ≈ <b>${tokens}</b> tokens ≈ <b>${esc(usd)}</b> via ${esc(providerLabel)}.`;
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

// ── Whisper models card (docs/video-ingest.md) ───────────────────────────────
async function fillWhisperCard(root, catalogueRows, ytdlpVer) {
  const card = root.querySelector('#card-whisper');
  if (!card) return;
  const body = card.querySelector('#whisper-card-body');
  const headSpan = card.querySelector('h4 span');
  const rows = Array.isArray(catalogueRows) ? catalogueRows : [];
  const installed = rows.filter(r => r.installed);
  const available = rows.filter(r => !r.installed);
  if (headSpan) {
    headSpan.textContent = installed.length ? `${installed.length} installed` : 'none installed';
  }

  function rowHtml(m) {
    const size = m.size_mb >= 1000 ? `${(m.size_mb / 1000).toFixed(1)} GB` : `${m.size_mb} MB`;
    const rec = m.tier === 'small.en' ? ' <span class="pill" style="margin-left:6px">recommended</span>' : '';
    // External installs (HF hub cache, env dir, system dir) show an
    // "Already installed" pill + source label. Delete button only appears
    // for app-managed installs — we never delete files we don't own.
    const SOURCE_LABELS = {
      app: 'Installed', hf_hub: 'HuggingFace cache',
      custom: 'Custom dir', system: 'System dir',
    };
    const sourcePill = m.installed && m.source
      ? `<span class="pill" style="margin-left:6px;background:rgba(45,156,68,0.15);color:#2d7a3e" title="${m.path ? m.path.replace(/"/g,'&quot;') : ''}">${SOURCE_LABELS[m.source] || m.source}</span>`
      : '';

    let action;
    if (!m.installed) {
      action = `<button class="btn btn-primary btn-xs icon-btn" data-act="download" data-tier="${m.tier}">
           <i data-lucide="download"></i> Download
         </button>`;
    } else if (m.source === 'app') {
      action = `<button class="btn btn-ghost btn-xs btn-bordered" data-act="default" data-tier="${m.tier}">Set default</button>
         <button class="btn btn-ghost btn-xs btn-bordered" data-act="delete"  data-tier="${m.tier}" style="color:var(--chronic,#B84747)">Delete</button>`;
    } else {
      // External — offer to set-default only. No delete (not ours to remove).
      action = `<button class="btn btn-ghost btn-xs btn-bordered" data-act="default" data-tier="${m.tier}">Use it</button>`;
    }

    return `
      <div class="whisper-row" data-tier="${m.tier}" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px dashed var(--line)">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px">${m.tier}${rec}${sourcePill}</div>
          <div style="color:var(--ink-3);font-size:12px">${size} · ${m.rtf}× realtime · ${m.repo}</div>
          <div class="whisper-progress" style="display:none;margin-top:6px;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--ink-3)"></div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">${action}</div>
      </div>`;
  }

  body.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:6px;font-size:12px;color:var(--ink-3)">
      <span><b>${installed.length}</b> installed</span>
      <span>·</span>
      <span><b>${available.length}</b> available</span>
    </div>
    ${rows.map(rowHtml).join('')}
    ${rows.length === 0 ? '<div class="empty-state" style="padding:12px">Catalogue unavailable — is the Python sidecar running?</div>' : ''}
    <p style="color:var(--ink-3);font-size:12px;margin-top:10px">
      Pick <code>medium.en</code> or <code>large-v3</code> for max accuracy on accents / noisy audio. <code>small.en</code> is fine for most clear-English talks and podcasts.
    </p>`;
  window.refreshIcons?.();

  const verLine = card.querySelector('#ytdlp-version-line');
  if (verLine && ytdlpVer) {
    const installedV = ytdlpVer.installed || '—';
    const latestV = ytdlpVer.latest || '—';
    const stale = installedV !== '0' && latestV !== '—' && installedV !== latestV;
    verLine.innerHTML = stale
      ? `Installed <b>${installedV}</b> · latest <b>${latestV}</b> <span class="pill" style="margin-left:6px;background:rgba(184,130,47,0.18);color:#8a5f1f">update available</span>`
      : `Installed <b>${installedV}</b> · latest <b>${latestV}</b>`;
  }

  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const tier = btn.dataset.tier;
    const row = body.querySelector(`.whisper-row[data-tier="${tier}"]`);
    const prog = row?.querySelector('.whisper-progress');

    if (act === 'download') {
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2"></i> Downloading…';
      window.refreshIcons?.();
      if (prog) { prog.style.display = 'block'; prog.textContent = 'Starting…'; }
      const fmtWhisperProgress = (payload) => {
        const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
        let parsed = null;
        try { parsed = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch {}
        const evt = parsed?._progress || parsed;
        if (evt && typeof evt === 'object') {
          if (evt.stage === 'skip') {
            return 'Already installed — reusing existing model';
          }
          if (evt.stage === 'download') {
            const pct = Number(evt.pct);
            const doneMb = Number(evt.downloaded_mb);
            const totalMb = Number(evt.total_mb);
            const pctText = Number.isFinite(pct) ? `${pct.toFixed(1)}%` : '…';
            if (Number.isFinite(doneMb) && Number.isFinite(totalMb) && totalMb > 0) {
              return `Downloading… ${pctText} (${doneMb.toFixed(1)} / ${totalMb.toFixed(1)} MB)`;
            }
            return `Downloading… ${pctText}`;
          }
        }
        return raw.slice(0, 200);
      };
      const { listen } = await import('@tauri-apps/api/event');
      const un1 = await listen('whisper:download-progress', (ev) => {
        if (!prog) return;
        prog.textContent = fmtWhisperProgress(ev.payload);
      });
      const un2 = await listen('whisper:download-done', async (ev) => {
        try { un1(); un2(); } catch {}
        const ok = (ev.payload?.code ?? 0) === 0;
        if (prog) prog.textContent = ok ? '✓ installed' : `✗ download failed (exit ${ev.payload?.code})`;
        if (ok) {
          const [cat, ver] = await Promise.all([
            api.whisperCatalogue().catch(() => []),
            api.ytdlpVersion().catch(() => ({})),
          ]);
          fillWhisperCard(root, cat, ver);
        } else {
          btn.disabled = false;
          btn.innerHTML = '<i data-lucide="download"></i> Download';
          window.refreshIcons?.();
        }
      });
      try { await api.whisperDownload(tier); } catch (err) {
        if (prog) prog.textContent = `✗ ${err?.message || err}`;
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="download"></i> Download';
        window.refreshIcons?.();
      }
    }

    if (act === 'delete') {
      if (!confirm(`Delete the ${tier} model? You'll need to re-download to transcribe with it.`)) return;
      btn.disabled = true;
      try {
        await api.whisperDelete(tier);
        const [cat, ver] = await Promise.all([
          api.whisperCatalogue().catch(() => []),
          api.ytdlpVersion().catch(() => ({})),
        ]);
        fillWhisperCard(root, cat, ver);
      } catch (err) {
        alert(`Delete failed: ${err?.message || err}`);
        btn.disabled = false;
      }
    }

    if (act === 'default') {
      btn.disabled = true;
      try {
        await api.whisperSetDefault(tier);
        btn.textContent = 'Default ✓';
      } catch (err) {
        alert(`Set-default failed: ${err?.message || err}`);
        btn.disabled = false;
      }
    }
  });

  const updBtn = card.querySelector('#btn-ytdlp-update');
  updBtn?.addEventListener('click', async () => {
    updBtn.disabled = true;
    const orig = updBtn.textContent;
    updBtn.textContent = 'Checking…';
    try {
      const r = await api.ytdlpUpdate(true);
      if (r?.ok && r.updated) {
        alert(`Updated yt-dlp ${r.from} → ${r.to}.`);
      } else if (r?.ok && !r.updated) {
        alert(`Already on latest (${r.installed || 'current'}).`);
      } else {
        alert(`yt-dlp update: ${r?.reason || 'unknown'}`);
      }
      const ver = await api.ytdlpVersion().catch(() => ({}));
      if (verLine) verLine.innerHTML = `Installed <b>${ver.installed || '—'}</b> · latest <b>${ver.latest || '—'}</b>`;
    } catch (err) {
      alert(`Check failed: ${err?.message || err}`);
    } finally {
      updBtn.disabled = false;
      updBtn.textContent = orig;
    }
  });
}
