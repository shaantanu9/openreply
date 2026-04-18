import { api, $, $$ } from './api.js';
import { renderHome } from './screens/home.js';
import { renderTopic } from './screens/topic.js';
import { renderCollect } from './screens/collect.js';
import { renderSettings } from './screens/settings.js';
import { renderIngest } from './screens/ingest.js';
import { renderReports } from './screens/reports.js';
import { renderWelcome, isOnboardingComplete } from './screens/welcome.js';
import { renderActivity } from './screens/activity.js';
import { renderDatabase } from './screens/database.js';
import { renderScience } from './screens/science.js';

const routes = [
  { match: /^\/?$/,                 render: renderHome },
  { match: /^\/welcome\/?$/,        render: renderWelcome },
  { match: /^\/topics\/?$/,         render: renderHome },
  { match: /^\/topic\/([^/]+)$/,    render: renderTopic },
  { match: /^\/collect\/([^/]+)$/,  render: renderCollect },
  { match: /^\/settings\/?$/,       render: renderSettings },
  { match: /^\/ingest\/?$/,         render: renderIngest },
  { match: /^\/reports\/?$/,        render: renderReports },
  { match: /^\/activity\/?$/,       render: renderActivity },
  { match: /^\/database\/?$/,       render: renderDatabase },
  { match: /^\/science\/?$/,        render: renderScience },
];

async function route() {
  const hash = (location.hash || '#/').replace(/^#/, '');
  const main = $('#main-content');
  for (const r of routes) {
    const m = hash.match(r.match);
    if (m) {
      $$('.nav a').forEach(a => {
        const dr = a.dataset.route;
        a.classList.toggle('active', dr && hash.startsWith(dr) && !(dr === '/' && hash !== '/' && hash !== ''));
      });
      try {
        await r.render(main, { params: m.slice(1) });
      } catch (e) {
        main.innerHTML = `<div class="empty-state">Error: ${e?.message || e}</div>`;
      }
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
  route();

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

function wireModal() {
  const bd = $('#modal-backdrop');
  const open  = () => {
    bd.hidden = false;
    // give focus so Escape works
    setTimeout(() => $('#new-topic-input')?.focus(), 50);
  };
  const close = () => {
    bd.hidden = true;
    $('#new-topic-input').value = '';
  };
  $('#modal-cancel').onclick = close;
  // Backdrop click closes (if clicked directly, not a child)
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  // Escape closes
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !bd.hidden) close();
    if (e.key === 'Enter' && !bd.hidden && document.activeElement === $('#new-topic-input')) {
      $('#modal-start').click();
    }
  });
  $('#modal-start').onclick = () => {
    const topic = $('#new-topic-input').value.trim();
    if (!topic) {
      $('#new-topic-input').focus();
      return;
    }
    const aggressive = $('#new-topic-aggressive').checked;
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
  // Cmd/Ctrl+N → new topic
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      window.gapmapOpenNewTopic?.();
    }
  });
}
