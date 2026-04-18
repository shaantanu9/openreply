import { api, $, $$ } from './api.js';
import { renderHome } from './screens/home.js';
import { renderTopic } from './screens/topic.js';
import { renderCollect } from './screens/collect.js';
import { renderSettings } from './screens/settings.js';
import { renderIngest } from './screens/ingest.js';

// --------- hash router (/, /topics, /topic/<slug>, /collect/<slug>, /settings, /ingest) ---------
const routes = [
  { match: /^\/?$/,                render: renderHome,     label: 'Dashboard' },
  { match: /^\/topics\/?$/,        render: renderHome,     label: 'Topics' },
  { match: /^\/topic\/([^/]+)$/,   render: renderTopic,    label: 'Topic' },
  { match: /^\/collect\/([^/]+)$/, render: renderCollect,  label: 'Collect' },
  { match: /^\/settings\/?$/,      render: renderSettings, label: 'Settings' },
  { match: /^\/ingest\/?$/,        render: renderIngest,   label: 'Ingest' },
];

async function route() {
  const hash = (location.hash || '#/').replace(/^#/, '');
  const main = $('#main-content');
  for (const r of routes) {
    const m = hash.match(r.match);
    if (m) {
      // Highlight sidebar nav
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
  // Update sidebar counts once at boot
  try {
    const topics = await api.listTopics();
    if (Array.isArray(topics)) {
      const n = topics.length;
      $('#nav-topics-count').textContent = n;
      $('#nav-dash-count').textContent = n;
    }
  } catch {}
  // modal wiring
  wireModal();
  // initial route
  if (!location.hash) location.hash = '#/';
  route();
});

// --------- New topic modal ---------
function wireModal() {
  const bd = $('#modal-backdrop');
  const open  = () => { bd.hidden = false; $('#new-topic-input').focus(); };
  const close = () => { bd.hidden = true; $('#new-topic-input').value = ''; };
  $('#modal-cancel').addEventListener('click', close);
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  $('#modal-start').addEventListener('click', async () => {
    const topic = $('#new-topic-input').value.trim();
    if (!topic) return;
    const aggressive = $('#new-topic-aggressive').checked;
    close();
    const slug = encodeURIComponent(topic);
    location.hash = `#/collect/${slug}`;
    // slight delay so route renders first
    setTimeout(() => window.dispatchEvent(new CustomEvent('gapmap:start-collect', { detail: { topic, aggressive } })), 100);
  });
  // Global "new topic" handler so any button can trigger it
  window.gapmapOpenNewTopic = open;
}
