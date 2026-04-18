// Multi-step onboarding wizard.
// Step 1: value prop
// Step 2: optional setup (Reddit OAuth link + LLM key explanation)
// Step 3: pick first topic + start collect
//
// Persists completion in localStorage so returning users skip to dashboard.

import { api, $, esc } from '../api.js';
import { openByokModal } from './byok.js';

const ONBOARDING_KEY = 'gapmap.onboarding.completed';

export function isOnboardingComplete() {
  return localStorage.getItem(ONBOARDING_KEY) === 'true';
}
export function markOnboardingComplete() {
  localStorage.setItem(ONBOARDING_KEY, 'true');
}

const EXAMPLES = [
  { t: 'ATS resume and job search apps',   e: '📄', cover: 'cover-1' },
  { t: 'habit tracker apps',               e: '⏱', cover: 'cover-2' },
  { t: 'freelance invoicing tools',        e: '💸', cover: 'cover-3' },
  { t: 'note-taking apps',                 e: '🗒', cover: 'cover-4' },
  { t: 'meditation apps',                  e: '🧘', cover: 'cover-1' },
  { t: 'AI coding assistants',             e: '🤖', cover: 'cover-2' },
];

let currentStep = 1;

export async function renderWelcome(root) {
  const info = await api.cliInfo().catch(() => ({}));
  renderStep(root, currentStep, info);
}

function renderStep(root, step, info) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Welcome · <strong>Step ${step} of 3</strong></div>
      <div class="topbar-spacer"></div>
      <button id="skip-onboarding" class="pill">Skip onboarding</button>
    </header>

    <div class="wizard-stepper">
      <div class="step ${step >= 1 ? 'done' : ''} ${step === 1 ? 'active' : ''}">
        <span class="step-num">1</span><span>What is Gap Map</span>
      </div>
      <div class="step-line ${step >= 2 ? 'done' : ''}"></div>
      <div class="step ${step >= 2 ? 'done' : ''} ${step === 2 ? 'active' : ''}">
        <span class="step-num">2</span><span>Connect sources</span>
      </div>
      <div class="step-line ${step >= 3 ? 'done' : ''}"></div>
      <div class="step ${step >= 3 ? 'done' : ''} ${step === 3 ? 'active' : ''}">
        <span class="step-num">3</span><span>Your first topic</span>
      </div>
    </div>

    <div id="step-body" style="margin-top:28px"></div>
  `;

  document.getElementById('skip-onboarding').onclick = () => {
    markOnboardingComplete();
    location.hash = '#/';
  };

  const body = document.getElementById('step-body');
  if (step === 1) renderStep1(body);
  if (step === 2) renderStep2(body, info);
  if (step === 3) renderStep3(body);
}

function renderStep1(body) {
  body.innerHTML = `
    <section class="hero">
      <div>
        <div class="hero-eyebrow">Your research workspace</div>
        <h1>Map the gap<br/>in any market.</h1>
        <p>Drop a topic in, Gap Map pulls multi-source data (Reddit + HN + App Store + Play Store + academic + news), synthesises painpoints / DIY workarounds / competitor weaknesses, and renders an interactive graph with real citations.</p>
        <div class="hero-actions">
          <button class="btn btn-primary" id="next-1">Continue →</button>
        </div>
      </div>
      <div class="hero-stat">
        <div class="hero-stat-row"><div><h4>Everything is local</h4></div></div>
        <ul style="list-style:none;padding:0;margin:0;font-size:13px;color:#4A3729;line-height:1.9">
          <li>🖥 Runs on your machine</li>
          <li>🔒 Your data never leaves</li>
          <li>🌐 Your IP, your rate limits</li>
          <li>🗝 Bring your own keys (or skip)</li>
          <li>💾 All stored in local SQLite</li>
        </ul>
      </div>
    </section>

    <div class="section-head"><div><h2>How the pipeline works</h2><p>Four steps, fully automated.</p></div></div>
    <section class="stat-grid">
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon peach">1</div></div>
        <div class="stat-num" style="font-size:14px;line-height:1.35">Type a topic</div>
        <div class="stat-label" style="margin-top:6px">e.g. "resume ATS" or "habit tracker"</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon lavender">2</div></div>
        <div class="stat-num" style="font-size:14px;line-height:1.35">We fetch</div>
        <div class="stat-label" style="margin-top:6px">Reddit · HN · App Store · Play Store · arXiv · Scholar · GitHub · News</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon mint">3</div></div>
        <div class="stat-num" style="font-size:14px;line-height:1.35">We synthesise</div>
        <div class="stat-label" style="margin-top:6px">LLM extracts gap signals with real post evidence</div>
      </div>
      <div class="stat-card">
        <div class="stat-head"><div class="stat-icon sky">4</div></div>
        <div class="stat-num" style="font-size:14px;line-height:1.35">Interactive map</div>
        <div class="stat-label" style="margin-top:6px">Graph + findings + copy to tweet / PNG / Markdown</div>
      </div>
    </section>
  `;
  document.getElementById('next-1').onclick = () => {
    currentStep = 2;
    renderStep(document.getElementById('main-content'), 2);
  };
}

async function renderStep2(body, info) {
  // Re-read from the actual .env file in case the user previously saved keys there.
  let byok = { anthropic: { set: false }, reddit_client_id: { set: false }, reddit_client_secret: { set: false } };
  try { byok = await api.byokStatus(); } catch {}
  const oauthReady = info?.oauth_ready || (byok.reddit_client_id.set && byok.reddit_client_secret.set);
  const anthropic  = info?.anthropic_key || byok.anthropic.set;
  body.innerHTML = `
    <section>
      <div class="section-head">
        <div>
          <h2>Connect your sources <span style="color:var(--ink-3);font-size:14px;font-weight:600">(optional)</span></h2>
          <p>Gap Map works out of the box with public data. These extras unlock more.</p>
        </div>
      </div>

      <div class="settings-grid">
        <div class="settings-card">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <h4>Reddit OAuth <span style="color:var(--ink-3);font-size:12px;font-weight:500">(optional)</span></h4>
            <span class="pill ${oauthReady ? 'active' : ''}">${oauthReady ? '✓ connected' : 'public mode'}</span>
          </div>
          <p style="margin-top:4px">Higher rate limits (100/min vs 60/min public) + access to streaming APIs. Your password is never stored.</p>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-primary" style="padding:8px 14px;font-size:12px" id="btn-reddit-apps">Create Reddit app</button>
            <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line)" id="btn-guide">Setup guide</button>
          </div>
        </div>

        <div class="settings-card">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <h4>LLM provider <span style="color:var(--ink-3);font-size:12px;font-weight:500">(for AI extraction)</span></h4>
            <span class="pill ${anthropic ? 'active' : ''}">${anthropic ? '✓ anthropic key' : 'not set'}</span>
          </div>
          <p style="margin-top:4px">Extract painpoints / features / competitors / DIY patterns from the corpus. Three options:</p>
          <ul style="font-size:12px;color:var(--ink-2);padding-left:22px;margin-top:4px;line-height:1.75">
            <li><b>BYOK</b> — paste an Anthropic key below (~$0.50 / topic). Saved to <code>~/.config/reddit-myind/.env</code>.</li>
            <li><b>Claude via MCP</b> — use the bundled MCP server from Claude Code sessions, zero extra cost.</li>
            <li><b>Public mode</b> — skip the LLM entirely; collect + graph still work, enrichment stays manual.</li>
          </ul>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn btn-primary" style="padding:8px 14px;font-size:12px" id="btn-add-key">🗝 ${anthropic ? 'Manage keys' : 'Add API key'}</button>
            <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line)" id="btn-anthropic-console">Get Anthropic key</button>
          </div>
        </div>

        <div class="settings-card">
          <h4>Where your data lives</h4>
          <p>All data stays on your machine. Nothing uploaded, nothing shared.</p>
          <div class="kv-row"><b>SQLite DB</b><span>${esc(info.db_path || '—')}</span></div>
          <div class="kv-row"><b>Mode</b><span>${esc(info.mode || 'public')}</span></div>
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-top:24px;justify-content:space-between">
        <button class="btn btn-ghost" style="border:1px solid var(--line)" id="back-2">← Back</button>
        <button class="btn btn-primary" id="next-2">Continue →</button>
      </div>
    </section>
  `;
  document.getElementById('btn-reddit-apps').onclick = () => api.openUrl('https://www.reddit.com/prefs/apps');
  document.getElementById('btn-guide').onclick = () => api.openUrl('https://github.com/shaantanu98/reddit-myind/blob/master/README.md');
  document.getElementById('btn-add-key').onclick = () => {
    openByokModal(async () => {
      // Re-render step 2 with fresh status
      const fresh = await api.cliInfo().catch(() => ({}));
      renderStep2(body, fresh);
    });
  };
  document.getElementById('btn-anthropic-console').onclick = () =>
    api.openUrl('https://console.anthropic.com/settings/keys');
  document.getElementById('back-2').onclick = () => { currentStep = 1; renderStep(document.getElementById('main-content'), 1); };
  document.getElementById('next-2').onclick = () => { currentStep = 3; renderStep(document.getElementById('main-content'), 3); };
}

function renderStep3(body) {
  body.innerHTML = `
    <section>
      <div class="section-head">
        <div>
          <h2>Your first research topic</h2>
          <p>Pick from an example below, or type your own.</p>
        </div>
      </div>

      <input id="ob-topic-input" type="text" placeholder='e.g. "meditation apps"'
             style="width:100%;padding:16px 20px;border-radius:14px;font-family:inherit;font-size:16px;border:1px solid var(--line);background:var(--surface);margin-bottom:18px"
             autofocus />

      <label class="modal-check" style="padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:12px;margin-bottom:24px">
        <input type="checkbox" id="ob-aggressive" checked>
        <span><b>Aggressive mode</b> — pulls all sources + historical archive (~15 min on first run)</span>
      </label>

      <div class="section-head"><div><h2 style="font-size:15px">Or try an example</h2></div></div>
      <section class="topic-grid" id="ob-examples">
        ${EXAMPLES.map(ex => `
          <div class="topic-tile" data-topic="${esc(ex.t)}">
            <div class="topic-cover ${ex.cover}">${ex.e}</div>
            <h4>${esc(ex.t)}</h4>
            <div class="topic-stats"><span>Click to start</span></div>
          </div>
        `).join('')}
      </section>

      <div style="display:flex;gap:10px;margin-top:24px;justify-content:space-between">
        <button class="btn btn-ghost" style="border:1px solid var(--line)" id="back-3">← Back</button>
        <div style="display:flex;gap:10px">
          <button class="btn btn-ghost" style="border:1px solid var(--line)" id="skip-3">Skip — explore first</button>
          <button class="btn btn-primary" id="start-3">Start collect →</button>
        </div>
      </div>
    </section>
  `;

  const startWith = (topic, aggressive) => {
    if (!topic) {
      document.getElementById('ob-topic-input').focus();
      return;
    }
    markOnboardingComplete();
    const slug = encodeURIComponent(topic);
    location.hash = `#/collect/${slug}`;
  };

  document.getElementById('back-3').onclick = () => { currentStep = 2; renderStep(document.getElementById('main-content'), 2); };
  document.getElementById('skip-3').onclick = () => { markOnboardingComplete(); location.hash = '#/'; };
  document.getElementById('start-3').onclick = () => {
    const topic = document.getElementById('ob-topic-input').value.trim();
    const aggressive = document.getElementById('ob-aggressive').checked;
    startWith(topic, aggressive);
  };
  document.getElementById('ob-topic-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('start-3').click();
  });
  document.querySelectorAll('#ob-examples .topic-tile').forEach(el => {
    el.onclick = () => {
      document.getElementById('ob-topic-input').value = el.dataset.topic;
      startWith(el.dataset.topic, true);
    };
  });
}
