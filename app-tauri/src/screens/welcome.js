// Onboarding wizard — 4 steps.
//   1. Welcome / value prop
//   2. Profile (name + role)
//   3. Connect (LLM + Reddit, all optional)
//   4. First topic
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

const STEPS = [
  { n: 1, label: 'What is Gap Map' },
  { n: 2, label: 'Your profile' },
  { n: 3, label: 'Connect sources' },
  { n: 4, label: 'Your first topic' },
];

function getStep() {
  const s = parseInt(localStorage.getItem(STEP_KEY) || '1', 10);
  return Math.max(1, Math.min(STEPS.length, isNaN(s) ? 1 : s));
}
function setStep(n) {
  localStorage.setItem(STEP_KEY, String(n));
}

export async function renderWelcome(root) {
  // Render immediately with empty info — step 3 re-fetches live BYOK status
  // and step 2 doesn't need cliInfo to draw. Never block the wizard on a
  // cold sidecar.
  renderStep(root, getStep(), {});
  // Fetch cli info in background and re-render only if we're still on a
  // step that uses it.
  api.cliInfo().catch(() => null).then(info => {
    if (!info) return;
    const cur = getStep();
    // Only step 3 actually consumes cli info (mode, db_path shown).
    if (cur === 3) renderStep(root, cur, info);
  });
}

function renderStep(root, step, info) {
  setStep(step);
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Welcome · <strong>Step ${step} of ${STEPS.length}</strong></div>
      <div class="topbar-spacer"></div>
      <button id="skip-onboarding" class="pill">Skip setup</button>
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
    if (!confirm('Skip the wizard? You can rerun it anytime from Settings → Reset onboarding.')) return;
    markOnboardingComplete();
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
  if (step === 1) renderStep1(root, body, info);
  if (step === 2) renderStep2(root, body, info);
  if (step === 3) renderStep3(root, body, info);
  if (step === 4) renderStep4(root, body, info);
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
        <ul style="list-style:none;padding:0;margin:0;font-size:var(--fs-13);color:#4A3729;line-height:1.9">
          <li>🖥 Runs on your machine</li>
          <li>🔒 Your data never leaves</li>
          <li>🌐 Your IP, your rate limits</li>
          <li style="display:flex;align-items:center;gap:8px"><i data-lucide="key-round"></i> Bring your own keys (or skip)</li>
          <li>💾 All stored in local SQLite</li>
        </ul>
      </div>
    </section>

    <div class="section-head"><div><h2>How the pipeline works</h2><p>Four steps, fully automated.</p></div></div>
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
    markOnboardingComplete();
    location.hash = '#/product/new/setup';
  };
}

// ─── Step 2 · Profile ─────────────────────────────────────────────────────
function renderStep2(root, body, info) {
  const name  = localStorage.getItem('gapmap.profile.name')  || '';
  const email = localStorage.getItem('gapmap.profile.email') || '';
  const role  = localStorage.getItem('gapmap.profile.role')  || 'researcher';

  body.innerHTML = `
    <section class="hero" style="grid-template-columns:1fr;max-width:720px">
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

        <div class="settings-profile-fields" style="max-width:560px">
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

    <div style="display:flex;gap:10px;margin-top:24px;justify-content:space-between;max-width:720px">
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
  body.innerHTML = `<div class="empty-state" style="padding:40px">Loading key status…</div>`;

  let byok = {};
  try { byok = await api.byokStatus(); } catch {}

  const providers = [
    { k: 'anthropic',  label: 'Anthropic',       chip: '#D97757' },
    { k: 'openai',     label: 'OpenAI',          chip: '#10A37F' },
    { k: 'openrouter', label: 'OpenRouter',      chip: '#8B5CF6' },
    { k: 'groq',       label: 'Groq',            chip: '#F97316' },
    { k: 'deepseek',   label: 'DeepSeek',        chip: '#0EA5E9' },
    { k: 'mistral',    label: 'Mistral',         chip: '#FF7000' },
    { k: 'google',     label: 'Google Gemini',   chip: '#4285F4' },
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
          <p style="margin-top:4px">Painpoints / features / DIY workarounds need an LLM. You can use any of 8 providers (incl. free local Ollama).</p>
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
    </section>
  `;

  document.getElementById('ob-add-key').onclick = () => {
    openByokModal(async () => {
      // Refresh this step with latest key status
      const fresh = await api.cliInfo().catch(() => info);
      renderStep3(root, body, fresh);
    });
  };
  document.getElementById('ob-anthropic').onclick = () => api.openUrl('https://console.anthropic.com/settings/keys');
  document.getElementById('ob-ollama').onclick = () => api.openUrl('https://ollama.com/download');
  document.getElementById('ob-reddit-apps').onclick = () => api.openUrl('https://www.reddit.com/prefs/apps');
  document.getElementById('ob-guide').onclick = () => api.openUrl('https://github.com/shaantanu98/reddit-myind#readme');
  document.getElementById('back-3').onclick = () => renderStep(root, 2, info);
  document.getElementById('next-3').onclick = () => renderStep(root, 4, info);

  // Auto-run system diagnostics — shows a pass/fail card above the provider
  // chips so users on a fresh DMG install see immediately whether the
  // Python sidecar + DB + semantic model came up cleanly.
  const healthHost = document.getElementById('ob-health-host');
  if (healthHost) {
    healthHost.innerHTML = `<div class="hc-card"><div class="hc-card-head"><strong>Running system check…</strong></div></div>`;
    const runOnce = async () => {
      const payload = await runHealthCheck();
      renderHealthCard(healthHost, payload, {
        title: payload.ok ? 'System check passed' : 'System check — fix any red items',
        onRerun: runOnce,
      });
    };
    runOnce();
  }
}

// ─── Step 4 · First topic ─────────────────────────────────────────────────
function renderStep4(root, body, info) {
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

      <div style="display:flex;gap:10px;margin-top:24px;justify-content:space-between">
        <button class="btn btn-ghost" style="border:1px solid var(--line)" id="back-4">← Back</button>
        <div style="display:flex;gap:10px">
          <button class="btn btn-ghost" style="border:1px solid var(--line)" id="skip-4">Skip — explore first</button>
          <button class="btn btn-primary" id="start-4">Start collect →</button>
        </div>
      </div>
    </section>
  `;

  const input = document.getElementById('ob-topic-input');
  const agg = document.getElementById('ob-aggressive');

  const startWith = (topic) => {
    if (!topic) { input.focus(); return; }
    const aggressive = agg.checked;
    // Stash aggressive so collect.js picks it up.
    localStorage.setItem('gapmap.collect.last_aggressive', aggressive ? 'true' : 'false');
    localStorage.setItem('gapmap.pref.aggressive', aggressive ? 'true' : 'false');
    markOnboardingComplete();
    location.hash = `#/collect/${encodeURIComponent(topic)}`;
  };

  document.getElementById('back-4').onclick = () => renderStep(root, 3, info);
  document.getElementById('skip-4').onclick = () => { markOnboardingComplete(); location.hash = '#/'; };
  document.getElementById('start-4').onclick = () => startWith(input.value.trim());
  input.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('start-4').click(); });
  document.querySelectorAll('#ob-examples .topic-tile').forEach(el => {
    el.addEventListener('click', () => { input.value = el.dataset.topic; startWith(el.dataset.topic); });
  });
}
