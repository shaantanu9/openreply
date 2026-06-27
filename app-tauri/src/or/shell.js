// OpenReply shell for the Tauri app — sidebar + theme + Lucide + toast/modal.
// Ported from the prototype's app.js, adapted for the SPA (hash routes, driven by main.js).
import { api } from "./api.js";

const NAV = [
  { sec: null, items: [['agents', 'layout-grid', 'Agents']] },
  { sec: 'AGENT', items: [
    ['agent', 'gauge', 'Overview'],
    ['inbox', 'inbox', 'Inbox'],
    ['opportunities', 'target', 'Opportunities'],
    ['compose', 'pen-line', 'Compose'],
    ['queue', 'calendar-clock', 'Queue'],
    ['growth', 'trending-up', 'Growth'],
  ]},
  { sec: 'Intelligence', items: [
    ['keywords', 'key-round', 'Keywords'],
    ['subreddit', 'shield-check', 'Subreddit Intel'],
    ['knowledge', 'brain', 'Knowledge'],
    ['library', 'library', 'Library'],
    ['learning', 'brain-circuit', 'Learning'],
    ['brain', 'network', 'Brain'],
    ['analytics', 'bar-chart-3', 'Analytics'],
    ['geo', 'sparkles', 'AI Visibility'],
  ]},
  { sec: 'Account', items: [
    ['connections', 'plug', 'Connections'],
    ['settings', 'settings', 'Settings'],
    ['pricing', 'gem', 'Plans'],
  ]},
];
const AGENTS = [];  // no demo agents — the sidebar hydrates from the live backend
const linkBase = 'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition';
const idle = ' text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100';
const active = ' bg-reddit/10 text-reddit';

export function drawIcons() { if (window.lucide) window.lucide.createIcons(); }

function ensureLucide(cb) {
  if (window.lucide) { cb(); return; }
  let s = document.querySelector('script[data-lucide-cdn]');
  if (!s) {
    s = document.createElement('script');
    s.src = 'https://unpkg.com/lucide@latest';
    s.setAttribute('data-lucide-cdn', '');
    document.head.appendChild(s);
  }
  s.addEventListener('load', cb);
}

window.orToast = function (msg) {
  const t = document.createElement('div');
  t.className = 'fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-lg transition-opacity duration-300 dark:bg-white dark:text-zinc-900';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 1800);
};
window.orModal = function (o) {
  const ov = document.createElement('div');
  ov.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
  ov.innerHTML = `<div class="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
      <div class="mb-3 text-lg font-bold text-zinc-900 dark:text-white">${o.title || ''}</div>
      <div class="mb-4">${o.body || ''}</div>
      <div class="flex justify-end gap-2">
        <button data-x class="rounded-full border border-zinc-200 px-4 py-2 text-sm font-semibold dark:border-zinc-700">Cancel</button>
        <button data-ok class="rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white hover:bg-reddit-hi">${o.okText || 'Save'}</button>
      </div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-x]').onclick = close;
  ov.querySelector('[data-ok]').onclick = () => { if (o.onOk) o.onOk(ov); close(); };
  const f = ov.querySelector('input,textarea'); if (f) f.focus();
  return ov;
};

function sidebarHTML(routeKey) {
  const agent = localStorage.getItem('or-agent') || AGENTS[0] || '';
  const opts = [...new Set([agent, ...AGENTS])].filter(Boolean)
    .map(a => `<option${a === agent ? ' selected' : ''}>${a}</option>`).join('') +
    '<option value="__new">+ New agent…</option>';
  let h = `
    <a href="#/agents" class="flex items-center gap-2 px-1.5 pb-1 text-lg font-extrabold text-zinc-900 dark:text-white">
      <span class="h-5 w-5 rounded-full bg-reddit"></span> OpenReply</a>
    <div class="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700/70 dark:bg-zinc-800/50">
      <div class="mb-0.5 text-[11px] font-medium uppercase tracking-wider text-zinc-400">Active agent</div>
      <div class="relative overflow-hidden">
        <select id="agentSel" style="-webkit-appearance:none;-moz-appearance:none;appearance:none;background-image:none;width:calc(100% + 26px);" class="cursor-pointer truncate bg-transparent pr-6 text-sm font-bold text-zinc-900 focus:outline-none dark:text-white">${opts}</select>
        <i data-lucide="chevron-down" class="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"></i>
      </div></div>
    <div class="relative">
      <i data-lucide="search" class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"></i>
      <input id="navSearch" type="search" placeholder="Search…" autocomplete="off" class="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-reddit dark:border-zinc-700/70 dark:bg-zinc-800/50 dark:text-white"></div>
    <nav class="flex flex-col gap-0.5">`;
  for (const g of NAV) {
    const label = g.sec === 'AGENT' ? agent : g.sec;
    const attr = g.sec === 'AGENT' ? ' data-agent-label' : '';
    if (g.sec) h += `<div${attr} class="px-1.5 pt-3 pb-1 text-[11px] uppercase tracking-wider text-zinc-400">${label}</div>`;
    for (const [key, ic, lbl, tag] of g.items) {
      h += `<a href="#/${key}" class="${linkBase}${key === routeKey ? active : idle}">
        <i data-lucide="${ic}" class="h-4 w-4 shrink-0"></i><span class="flex-1">${lbl}</span>
        ${key === 'inbox'
          ? `<span id="inbox-badge" class="hidden min-w-[18px] rounded-full bg-reddit px-1.5 text-center text-[11px] font-extrabold text-white">0</span>`
          : tag ? `<span class="rounded-full bg-reddit px-1.5 text-[11px] font-extrabold text-white">${tag}</span>` : ''}</a>`;
    }
  }
  h += `</nav>
    <div class="mt-auto flex flex-col gap-2">
      <button id="themeToggle" class="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold dark:border-zinc-700/70 dark:bg-zinc-800/50">
        <span>Theme</span>
        <span class="relative h-[18px] w-[34px] rounded-full bg-zinc-300 dark:bg-zinc-700">
          <span id="themeKnob" class="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-reddit transition-all"></span></span></button>
      <a href="#/settings" class="flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
        <span class="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-extrabold text-white" id="side-avatar"></span>
        <span class="flex-1 truncate" data-user-name>${(localStorage.getItem('or-user-name') || 'You')}</span>
        <i data-lucide="settings" class="h-3.5 w-3.5"></i></a>
    </div>`;
  return h;
}
function syncKnob() {
  const k = document.getElementById('themeKnob'); if (!k) return;
  k.style.left = document.documentElement.classList.contains('dark') ? '2px' : '18px';
}

let bootned = false;
function bootOnce() {
  if (bootned) return; bootned = true;
  // generic feedback for otherwise-inert prototype buttons
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'themeToggle' || b.hasAttribute('onclick') || b.hasAttribute('data-ok') ||
        b.hasAttribute('data-x') || b.closest('#kinds') || b.closest('[data-step]')) return;
    const label = (b.getAttribute('data-toast') || b.textContent || 'Done').trim().replace(/\s+/g, ' ');
    window.orToast(label.length > 36 ? 'Done ✓' : label + ' ✓');
  });
  // Live Inbox count badge — refresh whenever an opportunity's status changes
  // (save / unsave / draft / dismiss all fire 'or-inbox-changed' from api.js).
  window.addEventListener('or-inbox-changed', () => { refreshInboxBadge().catch(() => {}); });
}

// Update the sidebar Inbox badge with the live count of saved opportunities.
export async function refreshInboxBadge() {
  if (!api.isTauri()) return;
  const b = document.getElementById('inbox-badge');
  if (!b) return;
  let n = 0;
  try {
    const r = await api.replyList('saved', 0, 200);
    n = (r && (r.total != null ? r.total : (r.opportunities || []).length)) || 0;
  } catch (e) { return; }
  if (n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.classList.remove('hidden'); }
  else { b.classList.add('hidden'); }
}

// Render sidebar for the given route. `full` hides it (onboarding / standalone).
export function mountShell(routeKey, full) {
  bootOnce();
  const side = document.getElementById('side');
  const view = document.getElementById('main-content');
  if (full) {
    if (side) side.style.display = 'none';
    return;
  }
  if (side) {
    side.style.display = '';
    side.className = 'w-60 shrink-0 border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 flex flex-col gap-3 sticky top-0 h-screen overflow-auto';
    side.innerHTML = sidebarHTML(routeKey);
  }
  // Fill the footer avatar (initials + deterministic colour) from the saved name.
  const av = document.getElementById('side-avatar');
  if (av) {
    const nm = (localStorage.getItem('or-user-name') || 'You').trim();
    const parts = nm.split(/\s+/).filter(Boolean);
    av.textContent = ((parts[0] || 'Y')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    const pal = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4'];
    let h = 0; for (const c of nm) h = (h * 31 + c.charCodeAt(0)) | 0;
    av.style.background = pal[Math.abs(h) % pal.length];
  }
  syncKnob();
  ensureLucide(drawIcons);
  const tt = document.getElementById('themeToggle');
  if (tt) tt.onclick = () => {
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('or-theme', dark ? 'dark' : 'light'); } catch (e) {}
    syncKnob();
  };
  const navSearch = document.getElementById('navSearch');
  if (navSearch) {
    const applyNavFilter = () => {
      const q = navSearch.value.trim().toLowerCase();
      side.querySelectorAll('nav a[href^="#/"]').forEach((a) => {
        const lbl = (a.textContent || '').toLowerCase();
        a.style.display = (!q || lbl.includes(q)) ? '' : 'none';
      });
      side.querySelectorAll('nav > div').forEach((div) => {
        let n = div.nextElementSibling, any = false;
        while (n && n.tagName === 'A') { if (n.style.display !== 'none') any = true; n = n.nextElementSibling; }
        div.style.display = (!q || any) ? '' : 'none';
      });
    };
    navSearch.oninput = applyNavFilter;
    navSearch.onkeydown = (e) => {
      if (e.key === 'Enter') { const f = side.querySelector('nav a[href^="#/"]:not([style*="none"])'); if (f) location.hash = f.getAttribute('href'); }
      else if (e.key === 'Escape') { navSearch.value = ''; applyNavFilter(); }
    };
  }
  const sel = document.getElementById('agentSel');
  if (sel) sel.onchange = () => {
    if (sel.value === '__new') { location.hash = '#/onboarding'; return; }
    try { localStorage.setItem('or-agent', sel.value); } catch (e) {}
    window.orToast('Switched to ' + sel.value);
    mountShell(routeKey, false);
  };

  // Live agents: replace the static switcher with real agents from the backend.
  if (api.isTauri()) { hydrateAgents(routeKey); refreshInboxBadge().catch(() => {}); }
}

async function hydrateAgents(routeKey) {
  let agents = [];
  try { agents = (await api.agentList())?.agents || []; } catch (e) { return; }
  const sel = document.getElementById('agentSel');
  // No agents yet (fresh install / after reset) — clear any stale selection so
  // no demo agent name lingers, and show only the "+ New agent…" entry.
  if (!agents.length) {
    try { localStorage.removeItem('or-agent'); } catch (e) {}
    if (sel) sel.innerHTML = '<option value="__new">+ New agent…</option>';
    const lab0 = document.querySelector('#side [data-agent-label]');
    if (lab0) lab0.textContent = 'Agent';
    return;
  }
  const active = agents.find((a) => a.active) || agents[0];
  if (sel) {
    sel.innerHTML = agents.map((a) =>
      `<option value="${a.id}"${a.id === active.id ? ' selected' : ''}>${a.name}</option>`).join('') +
      '<option value="__new">+ New agent…</option>';
    sel.onchange = async () => {
      if (sel.value === '__new') { location.hash = '#/onboarding'; return; }
      try { await api.agentUse(sel.value); } catch (e) {}
      window.orToast('Switched agent');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    };
  }
  const lab = document.querySelector('#side [data-agent-label]');
  if (lab) lab.textContent = active.name;
}
