// Onboarding wizard — 6 steps.
//   1. Welcome / value prop
//   2. Profile (name + role)
//   3. Connect (LLM + Reddit, all optional)
//   4. Video transcription (optional)
//   5. First topic
//   6. Device activation (required)
//
// State lives in localStorage:
//   - gapmap.onboarding.completed   → skip on future launches
//   - gapmap.onboarding.step        → resume at the same step if user nav'd away
//   - gapmap.profile.{name,email,role}
//   - gapmap.collect.last_aggressive → collect.js reads this so the toggle
//     actually takes effect on the next collect run

import { api, esc } from '../api.js';
import { openByokModal } from './byok.js';
import { avatarInitials } from './settings.js';
import { runHealthCheck, renderHealthCard } from '../lib/healthCheck.js';

const ONBOARDING_KEY = 'gapmap.onboarding.completed';
const STEP_KEY       = 'gapmap.onboarding.step';
const LICENSE_OK_KEY = 'gapmap.license.activated';

export function isOnboardingComplete() {
  return localStorage.getItem(ONBOARDING_KEY) === 'true';
}
export function markOnboardingComplete() {
  localStorage.setItem(ONBOARDING_KEY, 'true');
  localStorage.removeItem(STEP_KEY);
}

const EXAMPLES = [
  { t: 'ATS resume and job search apps',   icon: 'file-text',    cover: 'cover-1' },
  { t: 'habit tracker apps',               icon: 'check-circle-2',cover: 'cover-2' },
  { t: 'freelance invoicing tools',        icon: 'receipt',      cover: 'cover-3' },
  { t: 'note-taking apps',                 icon: 'notebook-pen', cover: 'cover-4' },
  { t: 'meditation apps',                  icon: 'flower-2',     cover: 'cover-1' },
  { t: 'AI coding assistants',             icon: 'terminal',     cover: 'cover-2' },
];

// All possible steps. Step 6 (Activate device) is conditionally shown
// based on the license-gate feature flag — see effectiveSteps() below.
const ALL_STEPS = [
  { n: 1, label: 'What is Gap Map' },
  { n: 2, label: 'Your profile' },
  { n: 3, label: 'Connect sources' },
  { n: 4, label: 'Video transcription' },
  { n: 5, label: 'Your first topic' },
  { n: 6, label: 'Activate device' },
];

// Cached at module load. License gate is env-driven, so it doesn't change
// during a single app session — safe to query once. Defaults to OFF (no
// step 6) if the call fails so a flaky sidecar can't trap users at the
// activation screen.
let _licenseGateEnabled = false;
let _licenseGateChecked = false;
async function ensureLicenseGateChecked() {
  if (_licenseGateChecked) return;
  try {
    const g = await api.licenseGateStatus();
    _licenseGateEnabled = !!g?.enabled;
  } catch {
    _licenseGateEnabled = false;
  }
  _licenseGateChecked = true;
}
function effectiveSteps() {
  return _licenseGateEnabled ? ALL_STEPS : ALL_STEPS.slice(0, 5);
}
// Backwards-compat alias so the existing rendering code keeps working
// without a sweep — `STEPS` now reflects the visible-to-user steps.
let STEPS = ALL_STEPS;

function getStep() {
  const s = parseInt(localStorage.getItem(STEP_KEY) || '1', 10);
  return Math.max(1, Math.min(STEPS.length, isNaN(s) ? 1 : s));
}
function setStep(n) {
  localStorage.setItem(STEP_KEY, String(n));
}

function normalizeLicenseApiBase(value) {
  const v = (value || '').trim();
  if (!v) return '';
  // Users often paste localhost without scheme; normalize for dev UX.
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/.*)?$/i.test(v)) {
    return `http://${v}`.replace(/\/$/, '');
  }
  return v.replace(/\/$/, '');
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidActivationKey(value) {
  return /^[A-Za-z0-9]{4}(?:-[A-Za-z0-9]{4}){3}$/.test(value);
}

async function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function getOnboardingPayload() {
  const profile = {
    name: (localStorage.getItem('gapmap.profile.name') || '').trim(),
    email: (localStorage.getItem('gapmap.profile.email') || '').trim(),
    role: (localStorage.getItem('gapmap.profile.role') || '').trim(),
  };
  return {
    profile,
    first_topic: (localStorage.getItem('gapmap.onboarding.pending_topic') || '').trim(),
    aggressive_collect: localStorage.getItem('gapmap.onboarding.pending_aggressive') === 'true',
  };
}

function humanizeActivationError(err) {
  const raw = (err?.message || String(err || '')).toLowerCase();
  // Check activation-key errors BEFORE generic 401 handling.
  if (
    raw.includes('invalid key') ||
    raw.includes('activation key') ||
    raw.includes('key must be 16 chars') ||
    raw.includes('key may only use')
  ) {
    return 'Activation key is invalid. Verify and retry.';
  }
  if (raw.includes('401') || raw.includes('invalid credentials') || raw.includes('unauthorized')) {
    return 'Login failed. Check email/password and try again.';
  }
  if (raw.includes('already') && raw.includes('device')) {
    return 'This key is already locked to another device. Contact support to reset activation.';
  }
  if (raw.includes('timeout') || raw.includes('network') || raw.includes('failed to send request')) {
    return 'Could not reach license server. Check internet and API base URL, then retry.';
  }
  return err?.message || String(err || 'Activation failed');
}

export async function renderWelcome(root) {
  // Resolve the license-gate flag BEFORE first render so the stepper count
  // is correct on the first paint. The check is cheap (env read) and
  // bounded with a default-OFF fallback on failure.
  await ensureLicenseGateChecked();
  STEPS = effectiveSteps();
  // Clamp the saved step in case the user previously advanced to step 6
  // under a gate-ON build and we're now gate-OFF.
  const cur = Math.min(getStep(), STEPS.length);
  setStep(cur);

  // Render immediately with empty info — step 3 re-fetches live BYOK status
  // and step 2 doesn't need cliInfo to draw. Never block the wizard on a
  // cold sidecar.
  renderStep(root, cur, {});
  // Fetch cli info in background and re-render only if we're still on a
  // step that uses it.
  api.cliInfo().catch(() => null).then(info => {
    if (!info) return;
    const now = getStep();
    if (now === 3) renderStep(root, now, info);
  });
}

function renderStep(root, step, info) {
  setStep(step);
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Welcome · <strong>Step ${step} of ${STEPS.length}</strong></div>
      <div class="topbar-spacer"></div>
      <button id="skip-onboarding" class="pill">${_licenseGateEnabled ? 'Go to activation' : 'Skip to app →'}</button>
    </header>

    <div class="wizard-stepper">
      ${STEPS.map((s, i) => `
        <div class="step ${step >= s.n ? 'done' : ''} ${step === s.n ? 'active' : ''}"
             data-step="${s.n}" role="button" tabindex="0">
          <span class="step-num">${s.n}</span><span>${esc(s.label)}</span>
        </div>
        ${i < STEPS.length - 1 ? `<div class="step-line ${step > s.n ? 'done' : ''}"></div>` : ''}
      `).join('')}
    </div>

    <div id="step-body" style="margin-top:28px"></div>
  `;

  document.getElementById('skip-onboarding').onclick = () => {
    if (_licenseGateEnabled) {
      renderStep(root, 6, info);
      return;
    }
    // Gate OFF — bail out of onboarding entirely, route to home.
    markOnboardingComplete();
    (async () => {
      try {
        const { bootstrapMcpClients } = await import('../lib/mcp_bootstrap.js');
        await bootstrapMcpClients({ tag: 'mcp:onboarding-skip-header' });
      } catch {}
    })();
    location.hash = '#/';
  };

  // Allow clicking a past step to jump back.
  root.querySelectorAll('.wizard-stepper .step').forEach(el => {
    el.addEventListener('click', () => {
      const target = Number(el.dataset.step);
      if (target <= step) renderStep(root, target, info);
    });
  });

  const body = document.getElementById('step-body');
  // Steps 3/4/6 are async — never let a stray rejection surface as an
  // "Unhandled promise rejection" in the console; log and move on.
  const onErr = (e) => console.warn('[onboarding] step render:', e?.message || e);
  if (step === 1) renderStep1(root, body, info);
  if (step === 2) renderStep2(root, body, info);
  if (step === 3) Promise.resolve(renderStep3(root, body, info)).catch(onErr);
  if (step === 4) Promise.resolve(renderStep4Whisper(root, body, info)).catch(onErr);
  if (step === 5) renderStep5(root, body, info);
  if (step === 6) Promise.resolve(renderStep6Activation(root, body, info)).catch(onErr);
  window.refreshIcons?.();
}

// ─── Step 1 · Value prop ──────────────────────────────────────────────────
function renderStep1(root, body, info) {
  body.innerHTML = `
    <section class="hero">
      <div>
        <div class="hero-eyebrow">Your research workspace</div>
        <h1>Map the gap<br/>in any market.</h1>
        <p>Drop a topic in, Gap Map pulls multi-source data (Reddit + HN + App Store + Play Store + academic + news), synthesises painpoints / DIY workarounds / competitor weaknesses, and renders an interactive graph with real citations.</p>
        <div class="hero-actions" style="gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary" id="next-1">Continue with exploring →</button>
          <button class="btn btn-ghost btn-bordered" id="next-1-product">I have a product → Product Mode</button>
        </div>
        <p class="muted" style="font-size:var(--fs-13);margin-top:10px">
          <b>Exploring:</b> one-shot research briefs per topic.
          <b>Product:</b> daily-use dashboard + signals for your product + competitors.
        </p>
      </div>
      <div class="hero-stat">
        <div class="hero-stat-row"><div><h4>Everything is local</h4></div></div>
        <ul style="list-style:none;padding:0;margin:0;font-size:var(--fs-13);color:#4A3729;line-height:1.9;display:grid;gap:6px">
          <li style="display:flex;align-items:center;gap:8px"><i data-lucide="monitor"></i> Runs on your machine</li>
          <li style="display:flex;align-items:center;gap:8px"><i data-lucide="shield-check"></i> Your data never leaves</li>
          <li style="display:flex;align-items:center;gap:8px"><i data-lucide="globe"></i> Your IP, your rate limits</li>
          <li style="display:flex;align-items:center;gap:8px"><i data-lucide="key-round"></i> LLM keys are optional (activation is required)</li>
          <li style="display:flex;align-items:center;gap:8px"><i data-lucide="database"></i> All stored in local SQLite</li>
        </ul>
      </div>
    </section>

    <div class="section-head"><div><h2>How the pipeline works</h2><p>Core research flow in 4 steps, then setup + activation.</p></div></div>
    <section class="stat-grid">
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon peach">1</div></div>
        <div class="stat-num" style="font-size:var(--fs-15);line-height:1.35">Type a topic</div>
        <div class="stat-label" style="margin-top:6px">e.g. "resume ATS" or "habit tracker"</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon lavender">2</div></div>
        <div class="stat-num" style="font-size:var(--fs-15);line-height:1.35">We fetch</div>
        <div class="stat-label" style="margin-top:6px">Reddit · HN · App Store · Play Store · arXiv · Scholar · GitHub · News</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon mint">3</div></div>
        <div class="stat-num" style="font-size:var(--fs-15);line-height:1.35">We synthesise</div>
        <div class="stat-label" style="margin-top:6px">LLM extracts gap signals with real post evidence</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon sky">4</div></div>
        <div class="stat-num" style="font-size:var(--fs-15);line-height:1.35">Interactive map</div>
        <div class="stat-label" style="margin-top:6px">Graph + findings + copy to tweet / PNG / Markdown</div>
      </div>
    </section>
  `;
  document.getElementById('next-1').onclick = () => renderStep(root, 2, info);
  document.getElementById('next-1-product').onclick = () => {
    localStorage.setItem('gapmap.onboarding.pending_route', '#/product/new/setup');
    renderStep(root, 2, info);
  };
}

// ─── Step 2 · Profile ─────────────────────────────────────────────────────
function renderStep2(root, body, info) {
  const name  = localStorage.getItem('gapmap.profile.name')  || '';
  const email = localStorage.getItem('gapmap.profile.email') || '';
  const role  = localStorage.getItem('gapmap.profile.role')  || 'researcher';

  body.innerHTML = `
    <section class="hero onboarding-profile-hero">
      <div>
        <div class="hero-eyebrow">Welcome</div>
        <h1 style="font-size:var(--fs-24)">Who are you?</h1>
        <p>Gap Map is 100% local — there's no sign-up. This is just for your avatar in the top-right and to personalize empty states. You can change it later in Settings.</p>

        <div class="settings-profile-head" style="margin:24px 0 18px">
          <div class="settings-avatar" id="ob-avatar" style="background:#FF8C42">${esc(avatarInitials(name))}</div>
          <div>
            <h4 style="margin:0">${esc(name || 'Your name here')}</h4>
            <p style="margin:2px 0 0;color:var(--ink-3);font-size:var(--fs-13)">${esc(email || 'optional email')}</p>
          </div>
        </div>

        <div class="settings-profile-fields onboarding-profile-fields">
          <label>
            <span>Display name</span>
            <input type="text" id="ob-name" value="${esc(name)}" placeholder="e.g. Alex Park" autofocus />
          </label>
          <label>
            <span>Email (optional)</span>
            <input type="email" id="ob-email" value="${esc(email)}" placeholder="optional — only used locally" />
          </label>
          <label style="grid-column:1 / -1">
            <span>What best describes you?</span>
            <select id="ob-role">
              ${['researcher', 'founder', 'designer', 'engineer', 'pm', 'marketer', 'other']
                .map(r => `<option value="${r}" ${r === role ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>
    </section>

    <div class="onboarding-profile-actions">
      <button class="btn btn-ghost" style="border:1px solid var(--line)" id="back-2">← Back</button>
      <button class="btn btn-primary" id="next-2">Continue →</button>
    </div>
  `;

  const nameEl  = document.getElementById('ob-name');
  const emailEl = document.getElementById('ob-email');
  const roleEl  = document.getElementById('ob-role');
  const avatar  = document.getElementById('ob-avatar');

  nameEl.addEventListener('input', () => {
    avatar.textContent = avatarInitials(nameEl.value);
  });
  const save = () => {
    localStorage.setItem('gapmap.profile.name',  nameEl.value.trim());
    localStorage.setItem('gapmap.profile.email', emailEl.value.trim());
    localStorage.setItem('gapmap.profile.role',  roleEl.value);
    window.dispatchEvent(new CustomEvent('gapmap:profile-updated'));
  };
  document.getElementById('back-2').onclick = () => { save(); renderStep(root, 1, info); };
  document.getElementById('next-2').onclick = () => { save(); renderStep(root, 3, info); };
  nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('next-2').click(); });
}

// ─── Step 3 · Connect sources ─────────────────────────────────────────────
async function renderStep3(root, body, info) {
  if (!body || !body.isConnected) return;
  body.innerHTML = `<div class="empty-state" style="padding:40px">Loading key status…</div>`;

  let byok = {};
  try { byok = await api.byokStatus(); } catch {}

  // Bail if the user navigated away (or this step was re-rendered) while we
  // awaited — otherwise the getElementById wiring below hits a detached/null
  // element and renderStep3 rejects (unhandled promise rejection in console).
  if (!body.isConnected) return;

  const providers = [
    { k: 'anthropic',  label: 'Anthropic',       chip: '#D97757' },
    { k: 'openai',     label: 'OpenAI',          chip: '#10A37F' },
    { k: 'openrouter', label: 'OpenRouter',      chip: '#8B5CF6' },
    { k: 'groq',       label: 'Groq',            chip: '#F97316' },
    { k: 'deepseek',   label: 'DeepSeek',        chip: '#0EA5E9' },
    { k: 'mistral',    label: 'Mistral',         chip: '#FF7000' },
    { k: 'google',     label: 'Google Gemini',   chip: '#4285F4' },
    { k: 'nvidia',     label: 'NVIDIA NIM',      chip: '#76B900' },
    { k: 'ollama',     label: 'Ollama (local)',  chip: '#64748B', isLocal: true },
  ];
  const isReady = (p) => p.isLocal ? (typeof byok[p.k] === 'string' && !!byok[p.k]) : !!byok[p.k]?.set;
  const readyCount = providers.filter(isReady).length;
  // Live Ollama probe — we'll replace the "× not set" / "✓ ready" chip with
  // the real service state (running / offline) once the fetch resolves.
  const ollamaUrl = (byok.ollama || byok.ollama_base_url || 'http://localhost:11434').replace(/\/$/, '');
  const redditReady = byok?.reddit_client_id?.set && byok?.reddit_client_secret?.set;
  const mode = info?.mode || 'public';

  body.innerHTML = `
    <section>
      <div class="section-head">
        <div>
          <h2>Connect your sources <span style="color:var(--ink-3);font-size:var(--fs-15);font-weight:600">(all optional)</span></h2>
          <p>Gap Map works out of the box — these just unlock more signal.</p>
        </div>
      </div>

      <div id="ob-health-host"></div>

      <div class="settings-grid">
        <!-- LLM -->
        <div class="settings-card">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <h4>AI extraction <span style="color:var(--ink-3);font-size:var(--fs-13);font-weight:500">(recommended)</span></h4>
            <span class="pill ${readyCount ? 'active' : ''}">${readyCount ? `✓ ${readyCount} ready` : 'none set'}</span>
          </div>
          <p style="margin-top:4px">Painpoints / features / DIY workarounds need an LLM. You can use any of 9 providers (incl. free local Ollama).</p>
          <div class="llm-grid" style="margin:10px 0 4px">
            ${providers.map(p => `
              <div class="llm-chip ${isReady(p) ? 'on' : 'off'}">
                <span class="llm-chip-name">${esc(p.label)}</span>
                <span class="llm-chip-state">${isReady(p) ? '✓ ready' : '× not set'}</span>
              </div>`).join('')}
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm icon-btn" id="ob-add-key"><i data-lucide="key-round"></i> ${readyCount ? 'Manage keys' : 'Add a key'}</button>
            <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="ob-anthropic"><i data-lucide="external-link"></i> Anthropic console</button>
            <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="ob-ollama"><i data-lucide="download-cloud"></i> Install Ollama</button>
          </div>
        </div>

        <!-- Reddit -->
        <div class="settings-card">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <h4>Reddit credentials <span style="color:var(--ink-3);font-size:var(--fs-13);font-weight:500">(optional)</span></h4>
            <span class="pill ${redditReady ? 'active' : ''}">${redditReady ? '✓ connected' : 'public mode'}</span>
          </div>
          <p style="margin-top:4px">Public mode works (60/min). With credentials: 100/min + better metadata. Your password is never stored.</p>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" id="ob-reddit-apps">Create Reddit app</button>
            <button class="btn btn-ghost btn-sm btn-bordered" id="ob-guide">Setup guide</button>
          </div>
        </div>

        <!-- Where data lives -->
        <div class="settings-card">
          <h4>Where your data lives</h4>
          <p>All data stays on your machine. Nothing uploaded.</p>
          <div class="kv-row"><b>SQLite DB</b><span>${esc(info?.db_path || '—')}</span></div>
          <div class="kv-row"><b>Current mode</b><span>${esc(mode)}</span></div>
          <p style="color:var(--ink-3);font-size:var(--fs-11);margin-top:8px">You can change any of this later from Settings.</p>
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-top:24px;justify-content:space-between">
        <button class="btn btn-ghost" style="border:1px solid var(--line)" id="back-3">← Back</button>
        <button class="btn btn-primary" id="next-3">${readyCount ? 'Continue →' : 'Continue without AI →'}</button>
      </div>
      <div id="ob-health-inline-status" style="margin-top:8px;color:var(--ink-3);font-size:12px"></div>
      <div id="ob-llm-checks" style="margin-top:8px"></div>
    </section>
  `;

  const onClick = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  onClick('ob-add-key', () => {
    openByokModal(async () => {
      // Refresh this step with latest key status
      const fresh = await api.cliInfo().catch(() => info);
      Promise.resolve(renderStep3(root, body, fresh)).catch(() => {});
    });
  });
  onClick('ob-anthropic', () => api.openUrl('https://console.anthropic.com/settings/keys'));
  onClick('ob-ollama', () => api.openUrl('https://ollama.com/download'));
  onClick('ob-reddit-apps', () => api.openUrl('https://www.reddit.com/prefs/apps'));
  onClick('ob-guide', () => api.openUrl('https://github.com/myind-ai/gapmap#readme'));
  onClick('back-3', () => renderStep(root, 2, info));
  const continueBtn = document.getElementById('next-3');
  if (!continueBtn) return;
  const healthInlineStatus = document.getElementById('ob-health-inline-status');
  const llmChecksHost = document.getElementById('ob-llm-checks');
  const checkItems = [
    'Python engine',
    'Local database',
    'Semantic model',
    'Configured LLM providers',
  ];
  const renderProgress = (activeIdx = -1, doneIdx = -1) => {
    const progressHost = document.getElementById('ob-health-run-lines');
    if (!progressHost) return;
    progressHost.innerHTML = checkItems.map((label, idx) => {
      let icon = '<span style="color:var(--ink-3)">○</span>';
      let color = 'var(--ink-3)';
      if (idx <= doneIdx) {
        icon = '<span style="color:#2d7a3e">✓</span>';
        color = '#2d7a3e';
      } else if (idx === activeIdx) {
        icon = '<span class="ob-spinner" style="width:12px;height:12px;border:2px solid var(--line);border-top-color:var(--orange);border-radius:50%;display:inline-block;animation:nowspin 1s linear infinite"></span>';
        color = 'var(--ink)';
      }
      return `<div style="display:flex;align-items:center;gap:8px;font-size:12px;line-height:1.8;color:${color}">${icon}<span>${esc(label)}</span></div>`;
    }).join('');
  };

  const renderLlmChecks = (rows = []) => {
    if (!llmChecksHost) return;
    if (!rows.length) {
      llmChecksHost.innerHTML = '';
      return;
    }
    llmChecksHost.innerHTML = `
      <div style="padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface)">
        <div style="font-size:12px;font-weight:700;margin-bottom:6px">LLM provider checks</div>
        ${rows.map(r => `
          <div style="display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.7">
            <span style="color:${r.ok ? '#2d7a3e' : '#B84747'}">${r.ok ? '✓' : '⚠'}</span>
            <span><b>${esc(r.provider)}</b>: ${esc(r.detail || '')}</span>
          </div>
        `).join('')}
      </div>
    `;
  };

  continueBtn.onclick = () => {
    // Onboarding is NEVER gated behind a dialog. Both the missing-LLM warning
    // and a failing health check are shown inline on this step (with a "Manage
    // keys" / "Add a key" button right here), so Continue always proceeds.
    // Earlier this used window.confirm(), which Tauri routes to the dialog
    // plugin — when that permission isn't active in a build it throws
    // "dialog.confirm not allowed" and TRAPPED the user on this step. No dialog
    // dependency now: continue straight through.
    renderStep(root, 4, info);
  };

  // Auto-run system diagnostics — shows a pass/fail card above the provider
  // chips so users on a fresh DMG install see immediately whether the
  // Python sidecar + DB + semantic model came up cleanly.
  const healthHost = document.getElementById('ob-health-host');
  if (healthHost) {
    healthHost.innerHTML = `
      <div class="hc-card">
        <div class="hc-card-head"><strong>Running system check…</strong></div>
        <div id="ob-health-run-lines" style="margin-top:2px;padding:4px 2px"></div>
      </div>
    `;
    const runOnce = async () => {
      // UX choice: never block the user mid-onboarding. Continue is enabled
      // from the start and its text doesn't change during checks — results
      // render as supplementary info in the card + LLM grid. Before this,
      // one slow/cold Python sidecar spawn could make the step feel hung
      // for 20-30 s while tickers churned.
      continueBtn.disabled = false;
      continueBtn.textContent = readyCount ? 'Continue →' : 'Continue without AI →';
      let idx = 0;
      renderProgress(0, -1);
      if (healthInlineStatus) healthInlineStatus.textContent = `Checking ${checkItems[0]}… (you can continue whenever)`;
      renderLlmChecks([]);
      const ticker = setInterval(() => {
        idx = Math.min(idx + 1, checkItems.length - 1);
        renderProgress(idx, idx - 1);
        if (healthInlineStatus) healthInlineStatus.textContent = `Checking ${checkItems[idx]}… (you can continue whenever)`;
      }, 900);
      try {
        // Tight bounds: 8 s for the Python health check (enough for a cold
        // `uv run` first-spawn, short enough that a user waits no longer
        // than they'd tolerate), 6 s per provider test (each runs in
        // parallel, so the total bound stays at ~6 s regardless of how
        // many providers they have configured).
        const payload = await withTimeout(runHealthCheck(), 8000, 'system check');
        const configured = providers.filter(p => isReady(p));
        let llmRows = [];
        if (!configured.length) {
          llmRows = [{
            provider: 'No provider key configured',
            ok: false,
            detail: 'Set up a key from Manage keys, or continue without AI extraction.',
          }];
        } else {
          llmRows = await Promise.all(configured.map(async (p) => {
            try {
              const res = await withTimeout(api.testLlm(p.k, null), 6000, `${p.label} provider test`);
              if (res?.ok) {
                return {
                  provider: p.label,
                  ok: true,
                  detail: `${res.model || 'default model'} (${res.latency_ms || '?'} ms)`,
                };
              }
              return {
                provider: p.label,
                ok: false,
                detail: res?.error || 'provider test failed',
              };
            } catch (e) {
              return {
                provider: p.label,
                ok: false,
                detail: e?.message || String(e || 'provider test failed'),
              };
            }
          }));
        }
        renderProgress(-1, checkItems.length - 1);
        renderLlmChecks(llmRows);
        renderHealthCard(healthHost, payload, {
          title: payload.ok ? 'System check passed' : 'System check — fix any red items',
          onRerun: runOnce,
        });
        const mandatoryIds = new Set(['sidecar', 'db', 'palace']);
        const mandatoryFailed = (payload.checks || []).some(c => mandatoryIds.has(c.id) && !c.ok);
        const llmWarn = llmRows.some(r => !r.ok);
        // Keep the button enabled no matter what. `dataset.blocked` used to
        // hard-disable; we now only surface it as an informational warning
        // in the inline status strip. User still decides.
        continueBtn.dataset.blocked = mandatoryFailed ? '1' : '0';
        continueBtn.dataset.llmWarn = llmWarn ? '1' : '0';
        continueBtn.disabled = false;
        continueBtn.textContent = readyCount ? 'Continue →' : 'Continue without AI →';
        if (healthInlineStatus) {
          if (mandatoryFailed) {
            healthInlineStatus.textContent = 'System check: one or more core components reported issues. You can still continue — fixes can land from Settings.';
          } else if (llmWarn) {
            healthInlineStatus.textContent = 'System check complete. LLM setup has issues — configure keys now or continue without AI.';
          } else {
            healthInlineStatus.textContent = 'System check complete. You can continue.';
          }
        }
      } catch (e) {
        // Fail-safe: never leave onboarding stuck in perpetual loading state.
        renderProgress(-1, -1);
        continueBtn.dataset.blocked = '0';
        continueBtn.dataset.llmWarn = '1';
        continueBtn.disabled = false;
        continueBtn.textContent = readyCount ? 'Continue →' : 'Continue without AI →';
        renderLlmChecks([{
          provider: 'System checks',
          ok: false,
          detail: 'Timed out while checking providers. You can skip this step now and set up your LLM provider later in Settings.',
        }]);
        if (healthInlineStatus) {
          healthInlineStatus.textContent = 'This check timed out. Continue now and set up your LLM provider later in Settings.';
        }
      } finally {
        clearInterval(ticker);
      }
    };
    runOnce();
  }
}

// ─── Step 4 · Whisper (video transcription) — optional ──────────────────
//
// Detects existing Whisper installs (HuggingFace hub cache, env dir, common
// system dirs) before suggesting a download. If the user already has
// `small.en` from any other Python project, they see "Found — Use it" and
// never download 480 MB again. Totally skippable: we store the user's
// decision in localStorage so the Settings card can nudge later.
async function renderStep4Whisper(root, body, info) {
  body.innerHTML = `
    <section>
      <div class="section-head">
        <div>
          <h2>Video transcription <span style="font-weight:500;color:var(--ink-3);font-size:14px">(optional)</span></h2>
          <p>Turn any YouTube / Vimeo / podcast URL into research rows. Audio stays local; Whisper runs on-device.</p>
        </div>
      </div>

      <div id="ob-whisper-state" style="padding:18px;border:1px solid var(--line);border-radius:12px;background:var(--surface)">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="ob-spinner" style="width:16px;height:16px;border:2px solid var(--line);border-top-color:var(--orange);border-radius:50%;animation:nowspin 1s linear infinite"></div>
          <span style="color:var(--ink-3)">Checking your Mac for existing Whisper installs…</span>
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-top:24px;justify-content:space-between">
        <button class="btn btn-ghost" style="border:1px solid var(--line)" id="back-4">← Back</button>
        <div style="display:flex;gap:10px">
          <button class="btn btn-ghost" style="border:1px solid var(--line)" id="skip-4">Skip — set up later</button>
          <button class="btn btn-primary" id="next-4">Continue →</button>
        </div>
      </div>
    </section>
  `;
  window.refreshIcons?.();

  document.getElementById('back-4').onclick = () => renderStep(root, 3, info);
  document.getElementById('skip-4').onclick = () => {
    localStorage.setItem('gapmap.onboarding.whisper_skipped', 'true');
    renderStep(root, 5, info);
  };
  document.getElementById('next-4').onclick = () => renderStep(root, 5, info);

  // Pull catalogue + yt-dlp version in parallel. catalogue() already unions
  // app-managed + external-detected installs, so one call is enough.
  let catalogue = [];
  try { catalogue = await api.whisperCatalogue(); } catch {}
  const panel = document.getElementById('ob-whisper-state');
  if (!panel) return;

  const installed = catalogue.filter(m => m.installed);
  const rec = catalogue.find(m => m.tier === 'small.en') || catalogue[0];

  function tierLine(m, primary = false) {
    const size = m.size_mb >= 1000 ? `${(m.size_mb / 1000).toFixed(1)} GB` : `${m.size_mb} MB`;
    const recBadge = m.tier === 'small.en' ? ' <span class="pill" style="margin-left:6px">recommended</span>' : '';
    const sourceBadge = m.installed && m.source && m.source !== 'app'
      ? ` <span class="pill" style="margin-left:6px;background:rgba(45,156,68,0.15);color:#2d7a3e">${m.source === 'hf_hub' ? 'HuggingFace cache' : m.source === 'custom' ? 'custom dir' : m.source}</span>`
      : m.installed ? ' <span class="pill" style="margin-left:6px;background:rgba(45,156,68,0.15);color:#2d7a3e">installed</span>' : '';
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:${primary ? 'var(--surface-2)' : 'var(--surface)'};cursor:pointer">
        <input type="radio" name="ob-tier" value="${esc(m.tier)}" ${primary ? 'checked' : ''} />
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px">${esc(m.tier)}${recBadge}${sourceBadge}</div>
          <div style="color:var(--ink-3);font-size:12px">${size} · ${m.rtf}× realtime${m.path ? ` · ${esc((m.path + '').slice(0, 80))}${(m.path.length > 80 ? '…' : '')}` : ''}</div>
        </div>
      </label>`;
  }

  if (installed.length > 0) {
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span class="pill" style="background:rgba(45,156,68,0.15);color:#2d7a3e">✓ Found existing install</span>
        <span style="color:var(--ink-3);font-size:13px">Gap Map can reuse ${installed.length} tier${installed.length > 1 ? 's' : ''} already on your Mac — no re-download.</span>
      </div>
      <div style="display:grid;gap:8px;margin-top:6px">
        ${catalogue.map(m => tierLine(m, m.tier === installed[0].tier)).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-primary btn-sm icon-btn" id="ob-use"><i data-lucide="check"></i> Use selected tier</button>
        <button class="btn btn-ghost btn-sm btn-bordered" id="ob-dl">Download a different tier</button>
      </div>
      <div id="ob-progress" style="display:none;margin-top:12px;padding:10px;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;font-family:ui-monospace,Menlo,monospace;font-size:11px"></div>
    `;
    window.refreshIcons?.();
  } else {
    const recTier = rec?.tier || 'small.en';
    panel.innerHTML = `
      <div style="margin-bottom:10px">
        <div style="font-weight:600;font-size:14px">No Whisper model detected on this Mac</div>
        <div style="color:var(--ink-3);font-size:13px;margin-top:4px">
          Recommended: <b>${esc(recTier)}</b> (${rec?.size_mb || 480} MB, ~${Math.round((rec?.rtf || 0.5) * 60)} min for a 60-min talk on M1 CPU).
          <br/>Downloaded from public HuggingFace repo <code>${esc(rec?.repo || 'Systran/faster-whisper-small.en')}</code> — no account required.
        </div>
      </div>
      <div style="display:grid;gap:8px;margin-top:6px">
        ${catalogue.map(m => tierLine(m, m.tier === recTier)).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-primary btn-sm icon-btn" id="ob-dl"><i data-lucide="download"></i> Download selected</button>
      </div>
      <div id="ob-progress" style="display:none;margin-top:12px;padding:10px;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;font-family:ui-monospace,Menlo,monospace;font-size:11px"></div>
      <p style="color:var(--ink-3);font-size:12px;margin-top:10px">You can skip this — <b>Settings → Whisper models</b> has the same controls any time later.</p>
    `;
    window.refreshIcons?.();
  }

  function selectedTier() {
    const checked = panel.querySelector('input[name="ob-tier"]:checked');
    return checked ? checked.value : (rec?.tier || 'small.en');
  }

  const useBtn = panel.querySelector('#ob-use');
  const dlBtn = panel.querySelector('#ob-dl');
  const progEl = panel.querySelector('#ob-progress');

  useBtn?.addEventListener('click', async () => {
    const tier = selectedTier();
    useBtn.disabled = true;
    try {
      await api.whisperSetDefault(tier);
      localStorage.setItem('gapmap.onboarding.whisper_configured', tier);
      if (progEl) {
        progEl.style.display = 'block';
        progEl.textContent = `✓ ${tier} set as default. Click Continue →`;
      }
    } catch (err) {
      if (progEl) {
        progEl.style.display = 'block';
        progEl.textContent = `✗ ${err?.message || err}`;
      }
      useBtn.disabled = false;
    }
  });

  dlBtn?.addEventListener('click', async () => {
    const tier = selectedTier();
    dlBtn.disabled = true;
    dlBtn.innerHTML = '<i data-lucide="loader-2"></i> Downloading…';
    window.refreshIcons?.();
    if (progEl) { progEl.style.display = 'block'; progEl.textContent = 'Starting…'; }

    const { listen } = await import('@tauri-apps/api/event');
    const un1 = await listen('whisper:download-progress', (ev) => {
      if (!progEl) return;
      const raw = typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload);
      progEl.textContent = raw.slice(0, 200);
    });
    const un2 = await listen('whisper:download-done', async (ev) => {
      try { un1(); un2(); } catch {}
      const ok = (ev.payload?.code ?? 0) === 0;
      if (progEl) progEl.textContent = ok ? `✓ ${tier} installed — click Continue →` : `✗ download failed (exit ${ev.payload?.code})`;
      if (ok) {
        try { await api.whisperSetDefault(tier); } catch {}
        localStorage.setItem('gapmap.onboarding.whisper_configured', tier);
      } else {
        dlBtn.disabled = false;
        dlBtn.innerHTML = '<i data-lucide="download"></i> Download selected';
        window.refreshIcons?.();
      }
    });
    try {
      await api.whisperDownload(tier);
    } catch (err) {
      if (progEl) progEl.textContent = `✗ ${err?.message || err}`;
      dlBtn.disabled = false;
      dlBtn.innerHTML = '<i data-lucide="download"></i> Download selected';
      window.refreshIcons?.();
    }
  });
}

// ─── Step 5 · First topic ─────────────────────────────────────────────────
function renderStep5(root, body, info) {
  const aggressivePref = localStorage.getItem('gapmap.pref.aggressive') !== 'false';
  body.innerHTML = `
    <section>
      <div class="section-head">
        <div>
          <h2>Your first research topic</h2>
          <p>Type a problem space, or pick an example.</p>
        </div>
      </div>

      <input id="ob-topic-input" type="text" placeholder='e.g. "meditation apps"'
             style="width:100%;padding:16px 20px;border-radius:14px;font-family:inherit;font-size:var(--fs-15);border:1px solid var(--line);background:var(--surface);margin-bottom:18px"
             autofocus />

      <label class="modal-check" style="padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:12px;margin-bottom:24px">
        <input type="checkbox" id="ob-aggressive" ${aggressivePref ? 'checked' : ''}>
        <span><b>Aggressive mode</b> — pulls all 10 sources + historical archive (~15 min first run, much faster after)</span>
      </label>

      <div class="section-head"><div><h2 style="font-size:var(--fs-15)">Or try an example</h2></div></div>
      <section class="topic-grid" id="ob-examples">
        ${EXAMPLES.map(ex => `
          <div class="topic-tile" data-topic="${esc(ex.t)}">
            <div class="topic-cover ${ex.cover}"><i data-lucide="${ex.icon}"></i></div>
            <h4>${esc(ex.t)}</h4>
            <div class="topic-stats"><span>Click to use this</span></div>
          </div>
        `).join('')}
      </section>

      <div style="display:flex;gap:10px;margin-top:24px;justify-content:space-between;flex-wrap:wrap">
        <button class="btn btn-ghost" style="border:1px solid var(--line)" id="back-5">← Back</button>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-ghost" style="border:1px solid var(--line)" id="skip-5">Skip for now</button>
          <button class="btn btn-primary" id="start-5">Continue to activation →</button>
        </div>
      </div>
    </section>
  `;

  const input = document.getElementById('ob-topic-input');
  const agg = document.getElementById('ob-aggressive');

  const startWith = (topic, allowEmpty = false) => {
    if (!topic && !allowEmpty) { input.focus(); return; }
    const aggressive = agg.checked;
    // Stash topic/aggressive so post-activation (or directly when the gate
    // is off) we can jump straight into collect.
    localStorage.setItem('gapmap.onboarding.pending_topic', topic || '');
    localStorage.setItem('gapmap.onboarding.pending_aggressive', aggressive ? 'true' : 'false');
    localStorage.setItem('gapmap.collect.last_aggressive', aggressive ? 'true' : 'false');
    localStorage.setItem('gapmap.pref.aggressive', aggressive ? 'true' : 'false');

    // Gate ON → continue to step 6 (Activate device) as before.
    // Gate OFF (default) → finish onboarding right here. No activation
    // required for the gate-off path; user can still activate from
    // Settings → Licence later when they obtain a key.
    if (_licenseGateEnabled) {
      renderStep(root, 6, info);
      return;
    }
    markOnboardingComplete();
    // Fire-and-forget MCP bootstrap so /mcp clients pick Gap Map up
    // without the user needing to visit Settings.
    (async () => {
      try {
        const { bootstrapMcpClients } = await import('../lib/mcp_bootstrap.js');
        await bootstrapMcpClients({ tag: 'mcp:onboarding-complete' });
      } catch {}
    })();
    const pendingRoute = localStorage.getItem('gapmap.onboarding.pending_route') || '';
    localStorage.removeItem('gapmap.onboarding.pending_topic');
    localStorage.removeItem('gapmap.onboarding.pending_aggressive');
    localStorage.removeItem('gapmap.onboarding.pending_route');
    if (pendingRoute) location.hash = pendingRoute;
    else if (topic) location.hash = `#/collect/${encodeURIComponent(topic)}`;
    else location.hash = '#/';
  };

  document.getElementById('back-5').onclick = () => renderStep(root, 4, info);
  document.getElementById('start-5').onclick = () => startWith(input.value.trim());
  document.getElementById('skip-5').onclick = () => startWith('', true);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('start-5').click(); });
  document.querySelectorAll('#ob-examples .topic-tile').forEach(el => {
    el.addEventListener('click', () => { input.value = el.dataset.topic; startWith(el.dataset.topic); });
  });
}

// ─── Step 6 · Activation (mandatory when license-gate is ON, optional when OFF) ──
async function renderStep6Activation(root, body, info) {
  const pendingTopic = localStorage.getItem('gapmap.onboarding.pending_topic') || '';
  const pendingAggressive = localStorage.getItem('gapmap.onboarding.pending_aggressive') === 'true';
  const savedBase = normalizeLicenseApiBase(localStorage.getItem('gapmap.license.api_base') || '');
  let envBase = '';
  try {
    const def = await api.licenseDefaultApiBase();
    envBase = normalizeLicenseApiBase(def?.api_base || '');
  } catch {}
  // Resolved server wins over any stale localStorage value; the user no longer
  // types this. envBase comes from license_default_api_base (dev env override
  // or the baked prod constant), then any saved base, then the prod default.
  const initialBase = envBase || savedBase || 'https://gapmap.myind.ai';
  const savedEmail = localStorage.getItem('gapmap.license.email') || '';

  // Read the license-gate feature flag. When OFF (default), reframe the step:
  // primary action is "Skip — start using Gap Map", activation is the optional
  // secondary. When ON, activation is required and the Skip path is hidden.
  let gateEnabled = false;
  try {
    const g = await api.licenseGateStatus();
    gateEnabled = !!g?.enabled;
  } catch {}

  const heroEyebrow = gateEnabled ? 'Final step' : 'Optional · final step';
  const heroTitle   = gateEnabled ? 'Activate this device' : 'Activate now or skip';
  const heroBlurb   = gateEnabled
    ? `Internet is required once for activation. Your key will be bound to this device signature and cannot be reused on another machine.`
    : `Activation is optional. You can use Gap Map immediately and activate later from Settings → Licence. Activation unlocks the per-device licence record on <code>${esc(initialBase || 'gapmap.myind.ai')}</code> — useful when we start issuing paid keys.`;

  body.innerHTML = `
    <section class="hero" style="grid-template-columns:1fr;width:min(100%,clamp(720px,92vw,1100px))">
      <div>
        <div class="hero-eyebrow">${esc(heroEyebrow)}</div>
        <h1 style="font-size:34px">${esc(heroTitle)}</h1>
        <p>${heroBlurb}</p>
        <details style="margin-top:10px">
          <summary style="cursor:pointer;color:var(--ink-2);font-size:12px">${gateEnabled ? 'Why activation is required' : 'When should I activate?'}</summary>
          <p style="margin:8px 0 0;color:var(--ink-3);font-size:12px">
            ${gateEnabled
              ? 'Activation ties your license to this device signature to prevent key sharing. LLM provider keys remain optional, but license activation is mandatory before app use.'
              : 'You only need to activate if you have a paid licence key from gapmap.myind.ai. The app, MCP server, and CLI all work without it. Activate later from Settings → Licence whenever you have a key.'}
          </p>
        </details>
        <div class="settings-profile-fields" style="max-width:620px;margin-top:16px">
          <label><span>Login email</span><input id="lic-email" type="email" placeholder="you@company.com" value="${esc(savedEmail)}" /></label>
          <label><span>Activation key</span><input id="lic-key" type="text" placeholder="XXXX-XXXX-XXXX-XXXX" autocapitalize="characters" spellcheck="false" /></label>
          <label><span>Password <span style="color:var(--ink-3);font-weight:400">(optional)</span></span><input id="lic-password" type="password" placeholder="Only if your account uses one" /></label>
        </div>
        <div class="kv-row" style="margin-top:10px"><b>Pending first topic</b><span>${esc(pendingTopic || 'Not set')}</span></div>
        <div class="kv-row"><b>Aggressive collect</b><span>${pendingAggressive ? 'on' : 'off'}</span></div>
        <div id="lic-status" style="margin-top:12px;color:var(--ink-3);font-size:12px"></div>
        ${gateEnabled ? '' : `
        <div style="margin-top:10px;display:flex;gap:14px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" id="ob-get-key" style="text-decoration:underline">
            Don't have a key? Sign up at gapmap.myind.ai →
          </button>
          <button class="btn btn-ghost btn-sm" id="ob-redeem-coupon" style="text-decoration:underline">
            Have a coupon? Redeem for a free key →
          </button>
        </div>`}
      </div>
    </section>
      <div style="display:flex;gap:10px;margin-top:24px;justify-content:space-between;width:min(100%,clamp(720px,92vw,1100px));flex-wrap:wrap;row-gap:8px">
      <button class="btn btn-ghost" style="border:1px solid var(--line)" id="back-6">← Back</button>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-bordered" id="test-6">Test server</button>
        ${gateEnabled
          ? `<button class="btn btn-primary" id="activate-6">Activate &amp; continue →</button>`
          : `<button class="btn btn-ghost btn-bordered" id="activate-6">Activate</button>
             <button class="btn btn-primary" id="skip-6">Skip — start using Gap Map →</button>`}
      </div>
    </div>`;
  if (!gateEnabled) {
    const getKey = document.getElementById('ob-get-key');
    if (getKey) getKey.onclick = () => api.openUrl('https://gapmap.myind.ai/sign-in');
    const redeem = document.getElementById('ob-redeem-coupon');
    if (redeem) redeem.onclick = () => api.openUrl('https://gapmap.myind.ai/redeem');
    const skipBtn = document.getElementById('skip-6');
    if (skipBtn) skipBtn.onclick = async () => {
      markOnboardingComplete();
      // Auto-bootstrap MCP clients on skip too — activation is optional but
      // MCP integration should "just work" out of the box when the gate is OFF.
      (async () => {
        try {
          const { bootstrapMcpClients } = await import('../lib/mcp_bootstrap.js');
          await bootstrapMcpClients({ tag: 'mcp:onboarding-skip' });
        } catch {}
      })();
      const topic = localStorage.getItem('gapmap.onboarding.pending_topic') || '';
      const pendingRoute = localStorage.getItem('gapmap.onboarding.pending_route') || '';
      localStorage.removeItem('gapmap.onboarding.pending_topic');
      localStorage.removeItem('gapmap.onboarding.pending_aggressive');
      localStorage.removeItem('gapmap.onboarding.pending_route');
      // Route — same logic as post-activation: pending-route > collect topic > home.
      if (pendingRoute) location.hash = pendingRoute;
      else if (topic) location.hash = `#/collect/${encodeURIComponent(topic)}`;
      else location.hash = '#/';
    };
  }

  const statusEl = document.getElementById('lic-status');
  // The route may have changed while this async step awaited (gate/api-base):
  // if the step-6 markup is no longer in the document, abort wiring instead of
  // dereferencing null elements (fixes "null is not an object" on lic-status).
  if (!statusEl) return;
  try {
    const sig = await api.deviceSignature();
    if (statusEl.isConnected) statusEl.textContent = `Device signature: ${sig?.device_signature?.slice(0, 16) || 'n/a'}…`;
  } catch {
    if (statusEl.isConnected) statusEl.textContent = 'Could not read local device signature.';
  }

  document.getElementById('back-6').onclick = () => renderStep(root, 5, info);
  document.getElementById('test-6').onclick = async () => {
    const apiBase = normalizeLicenseApiBase(initialBase);   // resolved server, no input
    statusEl.style.color = 'var(--ink-3)';
    statusEl.textContent = 'Testing server reachability...';
    try {
      const res = await api.licenseServerCheck(apiBase);
      statusEl.style.color = '#2d7a3e';
      statusEl.textContent = `Server reachable (${res?.status || 200}) via ${res?.url || apiBase}`;
    } catch (e) {
      statusEl.style.color = '#B84747';
      statusEl.textContent = humanizeActivationError(e);
    }
  };
  document.getElementById('activate-6').onclick = async () => {
    const btn = document.getElementById('activate-6');
    const apiBase = normalizeLicenseApiBase(initialBase);   // resolved server, no input
    const email = document.getElementById('lic-email').value.trim();
    // Password optional: the server authenticates on (email, activation key)
    // and ignores the value, but needs a non-empty string present.
    const password = document.getElementById('lic-password').value || 'desktop-activation';
    const activationKey = document.getElementById('lic-key').value.trim();
    if (!email || !activationKey) {
      statusEl.style.color = '#B84747';
      statusEl.textContent = 'Enter your email and activation key.';
      return;
    }
    if (!isValidEmail(email)) {
      statusEl.style.color = '#B84747';
      statusEl.textContent = 'Enter a valid email address.';
      return;
    }
    if (!isValidActivationKey(activationKey)) {
      statusEl.style.color = '#B84747';
      statusEl.textContent = 'Activation key format must be XXXX-XXXX-XXXX-XXXX.';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Activating…';
    statusEl.style.color = 'var(--ink-3)';
    statusEl.textContent = 'Contacting license server…';
    try {
      const onboarding = getOnboardingPayload();
      const res = await api.licenseActivate(apiBase, email, password, activationKey, onboarding);
      localStorage.setItem('gapmap.license.api_base', apiBase);
      localStorage.setItem('gapmap.license.email', email);
      localStorage.setItem(LICENSE_OK_KEY, 'true');
      markOnboardingComplete();

      // Activation is the gate for the MCP server. Previously auto-install
      // only ran at app open, so a user who activated mid-session had to
      // go to Settings → MCP and click Connect by hand. Kick the shared
      // bootstrap immediately so every detected client (Cursor / Claude
      // Code / Claude Desktop) gets wired up during the post-activation
      // "Redirecting…" beat. Fire-and-forget — navigation below shouldn't
      // wait on disk writes to config files.
      (async () => {
        try {
          const { bootstrapMcpClients } = await import('../lib/mcp_bootstrap.js');
          const results = await bootstrapMcpClients({ tag: 'mcp:post-activate' });
          // eslint-disable-next-line no-console
          console.info('[mcp:post-activate] results:', results);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[mcp:post-activate] skipped', e);
        }
      })();
      const topic = localStorage.getItem('gapmap.onboarding.pending_topic') || '';
      const pendingRoute = localStorage.getItem('gapmap.onboarding.pending_route') || '';
      const aggressive = localStorage.getItem('gapmap.onboarding.pending_aggressive') === 'true';
      localStorage.setItem('gapmap.collect.last_aggressive', aggressive ? 'true' : 'false');
      localStorage.removeItem('gapmap.onboarding.pending_topic');
      localStorage.removeItem('gapmap.onboarding.pending_aggressive');
      localStorage.removeItem('gapmap.onboarding.pending_route');
      localStorage.removeItem('gapmap.onboarding.step');
      if (topic) {
        statusEl.style.color = '#2d7a3e';
        statusEl.textContent = `Activated (${esc(res?.license_id || 'ok')}). Redirecting to collect…`;
        location.hash = `#/collect/${encodeURIComponent(topic)}`;
      } else if (pendingRoute) {
        statusEl.style.color = '#2d7a3e';
        statusEl.textContent = `Activated (${esc(res?.license_id || 'ok')}). Redirecting…`;
        location.hash = pendingRoute;
      } else {
        location.hash = '#/';
      }
    } catch (e) {
      statusEl.style.color = '#B84747';
      statusEl.textContent = humanizeActivationError(e);
      btn.disabled = false;
      btn.textContent = 'Activate & continue →';
    }
  };
}
