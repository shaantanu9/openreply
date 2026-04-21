// app-tauri/src/lib/tabs.js
import { refreshIcons } from '../icons.js';
import { openContextMenu } from './contextMenu.js';

const KEY = 'gapmap.tabs.v1';
const MAX_TABS = 50;
const MAX_CLOSED = 10;

function readStore() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshStore();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tabs)) return freshStore();
    return parsed;
  } catch { return freshStore(); }
}
function writeStore(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}
function freshStore() {
  const home = newTab('#/');
  return { version: 1, activeId: home.id, tabs: [home], closedStack: [] };
}
function newTab(hash) {
  return {
    id: 't_' + Math.random().toString(36).slice(2, 10),
    hash, title: titleForHash(hash), icon: iconForHash(hash),
    scroll: 0, state: {}, pinned: false, createdAt: Date.now(),
  };
}

export function titleForHash(hash) {
  const h = (hash || '').replace(/^#/, '') || '/';
  if (h === '/' || h === '') return 'Home';
  if (h === '/welcome') return 'Welcome';
  const m = h.match(/^\/topic\/([^/]+)/);
  if (m) return decodeURIComponent(m[1]);
  const c = h.match(/^\/collect\/([^/]+)/);
  if (c) return 'Collecting · ' + decodeURIComponent(c[1]);
  const rest = h.replace(/^\//, '').split('/')[0];
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
export function iconForHash(hash) {
  if (hash.includes('/topic/')) return 'target';
  if (hash.includes('/collect/')) return 'download-cloud';
  if (hash.includes('/settings')) return 'settings';
  if (hash.includes('/reports')) return 'file-text';
  if (hash.includes('/database')) return 'database';
  if (hash.includes('/search')) return 'search';
  return 'home';
}

const subs = new Set();
function notify() { subs.forEach(fn => { try { fn(); } catch {} }); }

export const tabStore = {
  getAll() { return readStore().tabs; },
  getActive() {
    const s = readStore();
    return s.tabs.find(t => t.id === s.activeId) || null;
  },
  open({ hash, foreground = true, duplicate = false } = {}) {
    const s = readStore();
    if (!duplicate) {
      const hit = s.tabs.find(t => t.hash === hash);
      if (hit) {
        if (foreground) s.activeId = hit.id;
        writeStore(s); notify();
        return hit.id;
      }
    }
    const tab = newTab(hash);
    s.tabs.push(tab);
    if (s.tabs.length > MAX_TABS) s.tabs.splice(0, s.tabs.length - MAX_TABS);
    if (foreground) s.activeId = tab.id;
    writeStore(s); notify();
    return tab.id;
  },
  close(id) {
    const s = readStore();
    const idx = s.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const [removed] = s.tabs.splice(idx, 1);
    s.closedStack.unshift({ hash: removed.hash, title: removed.title, closedAt: Date.now() });
    s.closedStack = s.closedStack.slice(0, MAX_CLOSED);
    if (s.tabs.length === 0) {
      const home = newTab('#/');
      s.tabs.push(home); s.activeId = home.id;
    } else if (s.activeId === id) {
      s.activeId = s.tabs[Math.max(0, idx - 1)].id;
    }
    writeStore(s); notify();
  },
  focus(id) {
    const s = readStore();
    if (!s.tabs.some(t => t.id === id)) return;
    s.activeId = id;
    writeStore(s); notify();
  },
  setTitle(id, title) {
    const s = readStore();
    const t = s.tabs.find(t => t.id === id);
    if (!t || t.title === title) return;
    t.title = title; t.icon = iconForHash(t.hash);
    writeStore(s); notify();
  },
  saveScroll(id, px) {
    const s = readStore();
    const t = s.tabs.find(t => t.id === id);
    if (!t) return;
    t.scroll = px;
    writeStore(s); // intentionally no notify — scroll saves shouldn't re-render
  },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
};

Object.assign(tabStore, {
  closeOthers(id) {
    const s = readStore();
    const keep = s.tabs.find(t => t.id === id);
    if (!keep) return;
    for (const t of s.tabs) if (t.id !== id)
      s.closedStack.unshift({ hash: t.hash, title: t.title, closedAt: Date.now() });
    s.closedStack = s.closedStack.slice(0, MAX_CLOSED);
    s.tabs = [keep]; s.activeId = keep.id;
    writeStore(s); notify();
  },
  closeToRight(id) {
    const s = readStore();
    const idx = s.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const rest = s.tabs.splice(idx + 1);
    for (const t of rest) s.closedStack.unshift({ hash: t.hash, title: t.title, closedAt: Date.now() });
    s.closedStack = s.closedStack.slice(0, MAX_CLOSED);
    if (!s.tabs.some(t => t.id === s.activeId)) s.activeId = s.tabs[s.tabs.length - 1].id;
    writeStore(s); notify();
  },
  reopenLastClosed() {
    const s = readStore();
    const last = s.closedStack.shift();
    if (!last) return null;
    const tab = newTab(last.hash);
    s.tabs.push(tab); s.activeId = tab.id;
    writeStore(s); notify();
    return tab.id;
  },
  reload(id) {
    const s = readStore();
    if (!s.tabs.some(t => t.id === id)) return;
    s.activeId = id;  // caller's router will re-render because activeId change fires notify
    writeStore(s); notify();
  },
  duplicate(id) {
    const s = readStore();
    const src = s.tabs.find(t => t.id === id);
    if (!src) return;
    const tab = newTab(src.hash);
    s.tabs.splice(s.tabs.indexOf(src) + 1, 0, tab);
    s.activeId = tab.id;
    writeStore(s); notify();
  },
  move(fromIdx, toIdx) {
    const s = readStore();
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= s.tabs.length || toIdx >= s.tabs.length) return;
    const [m] = s.tabs.splice(fromIdx, 1);
    s.tabs.splice(toIdx, 0, m);
    writeStore(s); notify();
  },
});

export function renderTabStrip(host) {
  if (!host) return;
  const paint = () => {
    const s = readStore();
    host.innerHTML = `
      <div class="tab-strip" role="tablist">
        ${s.tabs.map(t => `
          <div class="tab-pill ${t.id === s.activeId ? 'active' : ''}"
               role="tab" data-id="${t.id}" title="${t.title.replace(/"/g,'&quot;')}">
            <i data-lucide="${t.icon || 'circle'}"></i>
            <span class="tab-title">${t.title}</span>
            <span class="tab-close" data-close="${t.id}" title="Close (⌘W)">
              <i data-lucide="x"></i>
            </span>
          </div>
        `).join('')}
        <div class="tab-new" title="New tab (⌘T)"><i data-lucide="plus"></i></div>
      </div>
    `;
    refreshIcons?.();
  };
  paint();
  tabStore.subscribe(paint);

  host.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    if (close) { e.stopPropagation(); tabStore.close(close.dataset.close); return; }
    const nu = e.target.closest('.tab-new');
    if (nu) { tabStore.open({ hash: '#/' }); return; }
    const pill = e.target.closest('.tab-pill');
    if (pill) tabStore.focus(pill.dataset.id);
  });

  host.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const pill = e.target.closest('.tab-pill');
    if (pill) { e.preventDefault(); tabStore.close(pill.dataset.id); }
  });

  host.addEventListener('contextmenu', (e) => {
    const pill = e.target.closest('.tab-pill');
    if (!pill) return;
    e.preventDefault();
    const id = pill.dataset.id;
    openContextMenu(e.clientX, e.clientY, [
      { label: 'Reload',         icon: 'refresh-cw',   onClick: () => tabStore.reload(id) },
      { label: 'Duplicate',      icon: 'copy',         onClick: () => tabStore.duplicate(id) },
      { separator: true },
      { label: 'Close',          icon: 'x',            onClick: () => tabStore.close(id) },
      { label: 'Close others',   icon: 'minus-square', onClick: () => tabStore.closeOthers(id) },
      { label: 'Close to right', icon: 'chevron-right',onClick: () => tabStore.closeToRight(id) },
    ]);
  });
}
