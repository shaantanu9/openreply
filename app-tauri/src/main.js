import { api, $, $$, esc } from './api.js';
import { refreshIcons } from './icons.js';
import { renderHome, renderTopicsList } from './screens/home.js';
import { renderTopic } from './screens/topic.js';
import { renderCollect } from './screens/collect.js';
import { renderSettings } from './screens/settings.js';
import { renderIngest } from './screens/ingest.js';
import { renderReports } from './screens/reports.js';
import { renderWelcome, isOnboardingComplete } from './screens/welcome.js';
import { renderActivity } from './screens/activity.js';
import { renderDatabase } from './screens/database.js';
import { renderScience } from './screens/science.js';
import { renderSearch } from './screens/search.js';
import { renderWatch } from './screens/watch.js';

const routes = [
  { match: /^\/?$/,                 render: renderHome },
  { match: /^\/welcome\/?$/,        render: renderWelcome },
  { match: /^\/topics\/?$/,         render: renderTopicsList },
  { match: /^\/topic\/([^/]+)$/,    render: renderTopic },
  { match: /^\/collect\/([^/]+)$/,  render: renderCollect },
  { match: /^\/settings\/?$/,       render: renderSettings },
  { match: /^\/ingest\/?$/,         render: renderIngest },
  { match: /^\/reports\/?$/,        render: renderReports },
  { match: /^\/activity\/?$/,       render: renderActivity },
  { match: /^\/database\/?$/,       render: renderDatabase },
  { match: /^\/science\/?$/,        render: renderScience },
  { match: /^\/search\/?$/,         render: renderSearch },
  { match: /^\/watch\/?$/,          render: renderWatch },
];

// Route generation counter — bumped on every navigation so screens can tell
// whether an in-flight async task (DB query, fetch) still applies to the
// currently-visible screen. Without this, a stale catch block from the
// previous screen would query for its own DOM id (now absent) and blow up,
// taking out the current screen via route()'s error handler.
let routeGen = 0;
export function currentRouteGen() { return routeGen; }

async function route() {
  const hash = (location.hash || '#/').replace(/^#/, '');
  const main = $('#main-content');
  const myGen = ++routeGen;
  for (const r of routes) {
    const m = hash.match(r.match);
    if (m) {
      main.dataset.routeGen = String(myGen);
      $$('.nav a').forEach(a => {
        const dr = a.dataset.route;
        a.classList.toggle('active', dr && hash.startsWith(dr) && !(dr === '/' && hash !== '/' && hash !== ''));
      });
      try {
        await r.render(main, { params: m.slice(1) });
      } catch (e) {
        // Only show the error if THIS route is still the active one — a stale
        // render from the prior screen can reject long after the user moved on.
        if (routeGen === myGen) {
          main.innerHTML = `<div class="empty-state">Error: ${e?.message || e}</div>`;
        } else {
          console.warn('[route] suppressed stale render error:', e);
        }
      }
      if (routeGen === myGen) refreshIcons();
      return;
    }
  }
  main.innerHTML = `<div class="empty-state">404 — not found</div>`;
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  // Wire modal + keyboard FIRST so Cancel / Escape work even before any data loads.
  // (The Python sidecar can take 5–10s to spin up the first time.)
  wireModal();
  wireKeyboard();

  // Explicit safety: ensure the modal is hidden on boot no matter what.
  const bd = $('#modal-backdrop');
  if (bd) bd.hidden = true;

  // If the user has completed onboarding, land on dashboard while data fetches.
  // If not, route straight to welcome — dashboard never renders until they finish.
  if (!location.hash || location.hash === '#/' || location.hash === '#') {
    // Fast, synchronous localStorage check — does not block on sidecar.
    if (!isOnboardingComplete()) {
      location.hash = '#/welcome';
    } else {
      location.hash = '#/';
    }
  }
  await route();

  // First route rendered — tell Rust to close splash + show main window.
  // Failure is non-fatal (non-Tauri dev preview etc.).
  try { await api.closeSplash(); } catch {}

  // Fetch sidebar counts in the background (non-blocking).
  (async () => {
    try {
      const topics = await api.listTopics();
      if (Array.isArray(topics)) {
        $('#nav-topics-count').textContent = topics.length;
        $('#nav-dash-count').textContent = topics.length;
        // Re-check: first-ever user with no topics AND not marked onboarded.
        if (!isOnboardingComplete() && topics.length === 0) {
          // Already on /welcome from above — keep it.
        }
      }
    } catch {}
  })();
});

// Helper — does the user have any LLM provider ready? Used by the new-topic
// warning modal before kicking off an aggressive collect.
async function hasLlmConfigured() {
  try {
    const s = await api.byokStatus();
    return !!(
      s?.anthropic?.set || s?.openai?.set || s?.openrouter?.set ||
      s?.groq?.set || s?.deepseek?.set || s?.mistral?.set || s?.google?.set ||
      s?.ollama || s?.ollama_base_url
    );
  } catch {
    return false;
  }
}

function wireModal() {
  const bd = $('#modal-backdrop');
  // Save which element had focus before opening so we can restore it on close.
  let returnFocusTo = null;
  const focusableSelector =
    'input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])';
  const open  = () => {
    // Honour the user's "aggressive by default" preference from Settings.
    const aggPref = localStorage.getItem('gapmap.pref.aggressive') !== 'false';
    const cb = $('#new-topic-aggressive');
    if (cb) cb.checked = aggPref;
    returnFocusTo = document.activeElement;
    bd.hidden = false;
    setTimeout(() => $('#new-topic-input')?.focus(), 50);
  };
  const close = () => {
    bd.hidden = true;
    $('#new-topic-input').value = '';
    if (returnFocusTo && typeof returnFocusTo.focus === 'function') {
      returnFocusTo.focus();
      returnFocusTo = null;
    }
  };
  $('#modal-cancel').onclick = close;
  // Backdrop click closes (if clicked directly, not a child)
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  // Escape closes; Tab is trapped inside the modal while it's open.
  document.addEventListener('keydown', e => {
    if (bd.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Enter' && document.activeElement === $('#new-topic-input')) {
      $('#modal-start').click();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = [...bd.querySelectorAll(focusableSelector)]
        .filter(el => !el.disabled && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  });
  $('#modal-start').onclick = async () => {
    const topic = $('#new-topic-input').value.trim();
    if (!topic) {
      $('#new-topic-input').focus();
      return;
    }
    // P1-5 — reject topic names that'll break downstream SQL/URLs.
    if (!/^[a-zA-Z0-9 _\-]{2,60}$/.test(topic)) {
      alert('Topic name must be 2-60 chars, letters/numbers/spaces/hyphens/underscores only.');
      $('#new-topic-input').focus();
      return;
    }
    const aggressive = $('#new-topic-aggressive').checked;

    // P0-3 — if no LLM is configured, painpoints won't be extracted. Warn the
    // user up front rather than letting them reach a blank gap-map later.
    if (aggressive && !(await hasLlmConfigured())) {
      const go = confirm(
        'No LLM key is configured. Collect will fetch posts but won\'t extract '
        + 'painpoints, features, or workarounds — the gap map will show sources only.\n\n'
        + 'Continue without AI? (Cancel to add a key first in Settings.)'
      );
      if (!go) {
        close();
        location.hash = '#/settings';
        return;
      }
    }

    localStorage.setItem('gapmap.collect.last_aggressive', aggressive ? 'true' : 'false');
    localStorage.setItem('gapmap.pref.aggressive',          aggressive ? 'true' : 'false');
    close();
    const slug = encodeURIComponent(topic);
    location.hash = `#/collect/${slug}`;
    setTimeout(() =>
      window.dispatchEvent(new CustomEvent('gapmap:start-collect', { detail: { topic, aggressive } })),
      100,
    );
  };
  window.gapmapOpenNewTopic = open;
}

function wireKeyboard() {
  document.addEventListener('keydown', e => {
    // Bail on any shortcut when the user is actively editing text — avoids
    // hijacking ? / n while they're typing in a form.
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    // Cmd/Ctrl+N → new topic
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      window.gapmapOpenNewTopic?.();
      return;
    }
    // ? (shift+/) → shortcuts help, unless the user is typing.
    if (!typing && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
      e.preventDefault();
      openShortcutsHelp();
    }
  });
}

function openShortcutsHelp() {
  if (document.querySelector('#shortcuts-help')) return;
  const host = document.createElement('div');
  host.id = 'shortcuts-help';
  host.className = 'modal-backdrop';
  host.hidden = false;
  host.innerHTML = `
    <div class="modal" style="max-width:460px">
      <h3>Keyboard shortcuts</h3>
      <p class="modal-sub">The basics — more coming soon.</p>
      <div class="shortcuts-list">
        <div class="shortcut-row"><kbd>⌘ N</kbd> <span>New topic</span></div>
        <div class="shortcut-row"><kbd>?</kbd> <span>Open this panel</span></div>
        <div class="shortcut-row"><kbd>Esc</kbd> <span>Close any open dialog</span></div>
        <div class="shortcut-row"><kbd>Enter</kbd> <span>Submit the focused form</span></div>
        <div class="shortcut-row"><kbd>Tab</kbd> / <kbd>⇧ Tab</kbd> <span>Cycle focus within a modal</span></div>
      </div>
      <div class="modal-actions" style="justify-content:flex-end">
        <button class="btn btn-primary btn-sm" id="shortcuts-close">Got it</button>
      </div>
    </div>
  `;
  document.body.appendChild(host);
  const returnFocusTo = document.activeElement;
  const close = () => {
    host.remove();
    document.removeEventListener('keydown', escHandler);
    if (returnFocusTo?.focus) returnFocusTo.focus();
  };
  function escHandler(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
  document.addEventListener('keydown', escHandler);
  host.addEventListener('click', e => { if (e.target === host) close(); });
  host.querySelector('#shortcuts-close').onclick = close;
  setTimeout(() => host.querySelector('#shortcuts-close')?.focus(), 10);
}
