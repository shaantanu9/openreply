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
    ['chat', 'message-square', 'Chat'],
    ['tasks', 'list-checks', 'Tasks'],
    ['growth', 'trending-up', 'Growth'],
  ]},
  { sec: 'Intelligence', items: [
    ['keywords', 'key-round', 'Keywords'],
    ['subreddit', 'shield-check', 'Subreddit Intel'],
    ['watch', 'users', 'Watch accounts'],
    ['knowledge', 'brain', 'Knowledge'],
    ['library', 'library', 'Library'],
    ['learning', 'brain-circuit', 'Learning'],
    ['brain', 'network', 'Brain'],
    ['analytics', 'bar-chart-3', 'Analytics'],
    ['geo', 'sparkles', 'AI Visibility'],
  ]},
  { sec: 'Account', items: [
    ['x-account', '<svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>', 'X Account'],
    ['connections', 'plug', 'Connections'],
    ['pricing', 'gem', 'Plans'],
  ]},
];
const AGENTS = [];  // no demo agents — the sidebar hydrates from the live backend
const linkBase = 'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition';
const idle = ' text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100';
const active = ' bg-reddit/10 text-reddit';

// Deterministic avatar initials + colour (mirrors the settings profile card).
function avatarInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
function avatarColor(name) {
  const palette = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4'];
  let h = 0; for (const c of String(name || 'x')) h = (h * 31 + c.charCodeAt(0)) | 0;
  return palette[Math.abs(h) % palette.length];
}

export function drawIcons() { if (window.lucide) window.lucide.createIcons(); }

// Lucide is bundled locally and assigned to window.lucide in main.js, so it is
// always available synchronously. (This used to lazy-inject the unpkg CDN
// script, which failed in the packaged app and left every icon missing.)
function ensureLucide(cb) { cb(); }

// ── Sidebar collapse (full ↔ rail) ─────────────────────────────────────────
// A single `body[data-sidebar]` attribute drives the layout; CSS in styles.css
// hides labels / shrinks #side in rail mode. State persists across launches.
const SIDEBAR_LS_KEY = 'or-sidebar.v1';
const SIDEBAR_STATES = ['full', 'rail'];

function currentSidebarState() {
  try {
    const s = localStorage.getItem(SIDEBAR_LS_KEY);
    return SIDEBAR_STATES.includes(s) ? s : 'full';
  } catch (e) { return 'full'; }
}

function applySidebarState(state) {
  if (!SIDEBAR_STATES.includes(state)) state = 'full';
  document.body.setAttribute('data-sidebar', state);
  try { localStorage.setItem(SIDEBAR_LS_KEY, state); } catch (e) {}
  // Keep the collapse-button affordance in sync with the active state.
  const btn = document.getElementById('side-collapse');
  if (btn) {
    const icon = btn.querySelector('i[data-lucide]');
    if (icon) { icon.setAttribute('data-lucide', state === 'rail' ? 'panel-left-open' : 'panel-left-close'); drawIcons(); }
    btn.title = state === 'rail' ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)';
    btn.setAttribute('aria-label', btn.title);
  }
}

function cycleSidebar() {
  applySidebarState(currentSidebarState() === 'rail' ? 'full' : 'rail');
}

let sidebarKeyBound = false;
// Restore the saved state and wire the toggle button + ⌘B / Ctrl+B shortcut.
// Safe to call on every mount: the keydown listener binds once.
function initSidebar() {
  applySidebarState(currentSidebarState());
  const btn = document.getElementById('side-collapse');
  if (btn) btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); cycleSidebar(); };
  if (!sidebarKeyBound) {
    sidebarKeyBound = true;
    window.__orCycleSidebar = cycleSidebar;
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B')) {
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
        e.preventDefault();
        cycleSidebar();
      }
    });
  }
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
  ov.innerHTML = `<div class="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
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
    <div class="flex items-center gap-2 px-1.5 pb-1">
      <a href="#/agents" class="flex min-w-0 flex-1 items-center gap-2 text-lg font-extrabold text-zinc-900 dark:text-white">
        <span class="h-5 w-5 shrink-0 rounded-full bg-reddit"></span>
        <span class="brand-text truncate">OpenReply</span></a>
      <button id="side-collapse" type="button" title="Collapse sidebar (⌘B)" aria-label="Collapse sidebar"
        class="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
        <i data-lucide="panel-left-close" class="h-4 w-4"></i></button>
    </div>
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
      const iconHtml = ic.startsWith('<svg')
        ? ic
        : `<i data-lucide="${ic}" class="h-4 w-4 shrink-0"></i>`;
      h += `<a href="#/${key}" title="${lbl}" class="${linkBase}${key === routeKey ? active : idle}">
        ${iconHtml}<span class="nav-label flex-1">${lbl}</span>
        ${key === 'inbox'
          ? `<span id="inbox-badge" class="hidden min-w-[18px] rounded-full bg-reddit px-1.5 text-center text-[11px] font-extrabold text-white">0</span>`
          : tag ? `<span class="rounded-full bg-reddit px-1.5 text-[11px] font-extrabold text-white">${tag}</span>` : ''}</a>`;
    }
  }
  h += `</nav>
    <div class="mt-auto">
      <button id="accountMenu" class="flex w-full items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-2 text-left transition hover:bg-zinc-100 dark:border-zinc-700/70 dark:bg-zinc-800/50 dark:hover:bg-zinc-800">
        <span id="side-avatar" class="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-extrabold text-white"></span>
        <span data-user-name class="flex-1 truncate text-sm font-semibold text-zinc-900 dark:text-white">${(localStorage.getItem('or-user-name') || 'You')}</span>
        <i data-lucide="chevron-up" class="h-4 w-4 shrink-0 text-zinc-400"></i>
      </button>
    </div>`;
  return h;
}

function accountPopoverHTML() {
  const nm = (localStorage.getItem('or-user-name') || 'You').trim();
  const email = (localStorage.getItem('or-user-email') || '').trim();
  const company = (localStorage.getItem('or-user-company') || '').trim();
  const sub = [email, company].filter(Boolean).join(' · ') || 'Local account';
  const isDark = document.documentElement.classList.contains('dark');
  return `<div id="accountPopover" class="fixed bottom-4 left-4 z-50 w-56 rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
    <div class="px-3 py-2">
      <div class="text-sm font-bold text-zinc-900 dark:text-white">${nm}</div>
      <div class="text-xs text-zinc-500 dark:text-zinc-400 truncate">${sub}</div>
    </div>
    <div class="h-px bg-zinc-200 dark:bg-zinc-800"></div>
    <button id="popoverTheme" class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
      <span class="flex items-center gap-2"><i data-lucide="${isDark ? 'moon' : 'sun'}" class="h-4 w-4"></i> Theme</span>
      <span class="text-xs text-zinc-500 dark:text-zinc-400" id="themeLabel">${isDark ? 'Dark' : 'Light'}</span>
    </button>
    <a href="#/settings" class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
      <i data-lucide="settings" class="h-4 w-4"></i> Settings
    </a>
  </div>`;
}

let popoverEl = null;
function openAccountPopover() {
  if (popoverEl) { closeAccountPopover(); return; }
  popoverEl = document.createElement('div');
  popoverEl.innerHTML = accountPopoverHTML();
  const panel = popoverEl.firstElementChild;
  document.body.appendChild(panel);
  drawIcons();

  const close = () => {
    if (!popoverEl) return;
    popoverEl.firstElementChild?.remove();
    popoverEl = null;
  };

  const onDocClick = (e) => {
    if (!popoverEl) return;
    const menu = document.getElementById('accountMenu');
    if (menu && (e.target === menu || menu.contains(e.target))) return;
    if (!panel.contains(e.target)) close();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  // Defer binding so the same click that opened the menu doesn't close it.
  setTimeout(() => {
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
  }, 0);

  panel.querySelector('#popoverTheme').onclick = (e) => {
    e.stopPropagation();
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('or-theme', dark ? 'dark' : 'light'); } catch (e) {}
    const lbl = panel.querySelector('#themeLabel');
    const icon = panel.querySelector('#popoverTheme i[data-lucide]');
    if (lbl) lbl.textContent = dark ? 'Dark' : 'Light';
    if (icon) { icon.setAttribute('data-lucide', dark ? 'moon' : 'sun'); drawIcons(); }
  };

  panel.querySelector('a[href="#/settings"]').onclick = (e) => {
    e.preventDefault();
    close();
    location.hash = '#/settings';
  };

  // clean up listeners when closed
  const origClose = close;
  popoverEl._close = () => {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
    origClose();
  };
}

function closeAccountPopover() {
  if (popoverEl && popoverEl._close) popoverEl._close();
  else if (popoverEl) { popoverEl.firstElementChild?.remove(); popoverEl = null; }
}
let bootned = false;
function bootOnce() {
  if (bootned) return; bootned = true;
  // generic feedback for otherwise-inert prototype buttons
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'accountMenu' || b.id === 'popoverTheme' ||
        b.hasAttribute('onclick') || b.hasAttribute('data-ok') ||
        b.hasAttribute('data-x') || b.closest('#kinds') || b.closest('[data-step]') ||
        b.closest('#accountPopover')) return;
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
    side.className = 'w-60 shrink-0 border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 flex flex-col gap-3 h-full overflow-y-auto';
    side.innerHTML = sidebarHTML(routeKey);
  }
  // Fill the footer avatar (initials + deterministic colour) from the saved name.
  refreshAccountUI();
  ensureLucide(drawIcons);
  initSidebar();
  const accountMenu = document.getElementById('accountMenu');
  if (accountMenu) accountMenu.onclick = (e) => { e.stopPropagation(); openAccountPopover(); };
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

// Refresh the sidebar footer and open account popover when the profile changes.
function refreshAccountUI() {
  const nm = (localStorage.getItem('or-user-name') || 'You').trim();
  const nameEl = document.querySelector('#side [data-user-name]');
  if (nameEl) nameEl.textContent = nm || 'You';
  const av = document.getElementById('side-avatar');
  if (av) {
    av.textContent = avatarInitials(nm);
    av.style.background = avatarColor(nm);
  }
  if (popoverEl) {
    popoverEl.firstElementChild?.remove();
    popoverEl = null;
    openAccountPopover();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('or-profile-changed', refreshAccountUI);
}
