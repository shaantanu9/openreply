import { api, $, $$ } from './api.js';
import { renderHome } from './screens/home.js';
import { renderTopic } from './screens/topic.js';
import { renderCollect } from './screens/collect.js';
import { renderSettings } from './screens/settings.js';
import { renderIngest } from './screens/ingest.js';
import { renderReports } from './screens/reports.js';
import { renderWelcome, isOnboardingComplete } from './screens/welcome.js';

const routes = [
  { match: /^\/?$/,                 render: renderHome },
  { match: /^\/welcome\/?$/,        render: renderWelcome },
  { match: /^\/topics\/?$/,         render: renderHome },
  { match: /^\/topic\/([^/]+)$/,    render: renderTopic },
  { match: /^\/collect\/([^/]+)$/,  render: renderCollect },
  { match: /^\/settings\/?$/,       render: renderSettings },
  { match: /^\/ingest\/?$/,         render: renderIngest },
  { match: /^\/reports\/?$/,        render: renderReports },
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

async function shouldShowWelcome() {
  // Skip if user has already completed onboarding
  if (isOnboardingComplete()) return false;
  // First-run: if we have zero topics AND no fetch history, route to welcome
  try {
    const topics = await api.listTopics();
    if (Array.isArray(topics) && topics.length > 0) return false;
    const activity = await api.recentActivity();
    return !Array.isArray(activity) || activity.length === 0;
  } catch {
    return true;
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  // Sidebar counts
  try {
    const topics = await api.listTopics();
    if (Array.isArray(topics)) {
      $('#nav-topics-count').textContent = topics.length;
      $('#nav-dash-count').textContent = topics.length;
    }
  } catch {}

  wireModal();
  wireKeyboard();

  // Decide where to land on first load
  if (!location.hash || location.hash === '#/' || location.hash === '#') {
    if (await shouldShowWelcome()) {
      location.hash = '#/welcome';
    } else {
      location.hash = '#/';
    }
  }
  route();
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
