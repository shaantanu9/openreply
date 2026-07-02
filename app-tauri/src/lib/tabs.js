// OpenReply Chrome-style tab strip — store + renderer.
// Owns the in-memory/localStorage state, title/icon resolution, and DOM rendering
// for the tab bar above #main-content.

const KEY = 'openreply.tabs.v1';
const MAX_TABS = 50;
const MAX_CLOSED = 10;
const HOME_HASH = '#/agents';

const ICON_FOR_ROUTE = {
  agents: 'layout-grid',
  agent: 'gauge',
  inbox: 'inbox',
  opportunities: 'target',
  compose: 'pen-line',
  queue: 'calendar-clock',
  chat: 'message-square',
  tasks: 'list-checks',
  growth: 'trending-up',
  keywords: 'key-round',
  subreddit: 'shield-check',
  knowledge: 'brain',
  library: 'library',
  learning: 'brain-circuit',
  brain: 'network',
  analytics: 'bar-chart-3',
  geo: 'sparkles',
  'x-account': null, // SVG handled below
  connections: 'plug',
  pricing: 'gem',
  settings: 'settings',
  alerts: 'bell',
  welcome: 'hand',
  onboarding: 'rocket',
  watch: 'eye',
  topic: 'target',
  collect: 'download-cloud',
};

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
  const home = newTab(HOME_HASH);
  return { version: 1, activeId: home.id, tabs: [home], closedStack: [] };
}

function newTab(hash) {
  return {
    id: 't_' + Math.random().toString(36).slice(2, 10),
    hash,
    title: titleForHash(hash),
    icon: iconForHash(hash),
    scroll: 0,
    state: {},
    pinned: false,
    createdAt: Date.now(),
  };
}

function routeSegments(hash) {
  const h = (hash || '').replace(/^#\/?/, '').split(/[?#]/)[0];
  return h ? h.split('/').filter(Boolean) : [];
}

export function titleForHash(hash) {
  const segs = routeSegments(hash);
  const first = segs[0] || '';
  if (!first || hash === '#/' || hash === '#') return 'Home';
  if (first === 'topic' && segs[1]) return decodeURIComponent(segs[1]);
  if (first === 'collect' && segs[1]) return 'Collecting · ' + decodeURIComponent(segs[1]);
  if (first === 'welcome') return 'Welcome';
  // Capitalize first segment (e.g. "opportunities" -> "Opportunities")
  return first.charAt(0).toUpperCase() + first.slice(1).replace(/-/g, ' ');
}

export function iconForHash(hash) {
  const first = routeSegments(hash)[0] || 'agents';
  return ICON_FOR_ROUTE[first] || 'circle';
}

function svgIcon(nameOrSvg) {
  if (!nameOrSvg) {
    // X icon fallback
    return `<svg viewBox="0 0 24 24" class="h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
  }
  return `<i data-lucide="${nameOrSvg}" class="h-3.5 w-3.5 shrink-0"></i>`;
}

const subs = new Set();
function notify() { subs.forEach((fn) => { try { fn(); } catch {} }); }

export const tabStore = {
  getAll() { return readStore().tabs; },
  getActive() {
    const s = readStore();
    return s.tabs.find((t) => t.id === s.activeId) || null;
  },
  open({ hash, foreground = true, duplicate = false } = {}) {
    const s = readStore();
    if (!duplicate) {
      const hit = s.tabs.find((t) => t.hash === hash);
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
    const idx = s.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const [removed] = s.tabs.splice(idx, 1);
    s.closedStack.unshift({ hash: removed.hash, title: removed.title, closedAt: Date.now() });
    s.closedStack = s.closedStack.slice(0, MAX_CLOSED);
    if (s.tabs.length === 0) {
      const home = newTab(HOME_HASH);
      s.tabs.push(home); s.activeId = home.id;
    } else if (s.activeId === id) {
      s.activeId = s.tabs[Math.max(0, idx - 1)].id;
    }
    writeStore(s); notify();
  },
  focus(id) {
    const s = readStore();
    if (!s.tabs.some((t) => t.id === id)) return;
    s.activeId = id;
    writeStore(s); notify();
  },
  setTitle(id, title) {
    const s = readStore();
    const t = s.tabs.find((t) => t.id === id);
    if (!t || t.title === title) return;
    t.title = title; t.icon = iconForHash(t.hash);
    writeStore(s); notify();
  },
  saveScroll(id, px) {
    const s = readStore();
    const t = s.tabs.find((t) => t.id === id);
    if (!t) return;
    t.scroll = px;
    writeStore(s); // intentionally no notify — scroll saves shouldn't re-render
  },
  saveState(id, patch) {
    const s = readStore();
    const t = s.tabs.find((t) => t.id === id);
    if (!t) return;
    Object.assign(t.state, patch);
    writeStore(s);
  },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
};

Object.assign(tabStore, {
  closeOthers(id) {
    const s = readStore();
    const keep = s.tabs.find((t) => t.id === id);
    if (!keep) return;
    for (const t of s.tabs) if (t.id !== id)
      s.closedStack.unshift({ hash: t.hash, title: t.title, closedAt: Date.now() });
    s.closedStack = s.closedStack.slice(0, MAX_CLOSED);
    s.tabs = [keep]; s.activeId = keep.id;
    writeStore(s); notify();
  },
  closeToRight(id) {
    const s = readStore();
    const idx = s.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const rest = s.tabs.splice(idx + 1);
    for (const t of rest) s.closedStack.unshift({ hash: t.hash, title: t.title, closedAt: Date.now() });
    s.closedStack = s.closedStack.slice(0, MAX_CLOSED);
    if (!s.tabs.some((t) => t.id === s.activeId)) s.activeId = s.tabs[s.tabs.length - 1].id;
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
    if (!s.tabs.some((t) => t.id === id)) return;
    const t = s.tabs.find((t) => t.id === id);
    if (t) t.reloadTs = Date.now();
    s.activeId = id;
    writeStore(s); notify();
  },
  duplicate(id) {
    const s = readStore();
    const src = s.tabs.find((t) => t.id === id);
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
  setActiveHash(hash) {
    // Used by router to rewrite the active tab's hash in-place (Chrome default).
    const s = readStore();
    const t = s.tabs.find((x) => x.id === s.activeId);
    if (!t || t.hash === hash) return;
    t.hash = hash; t.title = titleForHash(hash); t.icon = iconForHash(hash);
    writeStore(s); notify();
  },
});

function drawIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

export function renderTabStrip(host, contextMenu, { isLoading = () => false } = {}) {
  if (!host) return;
  let dragId = null;

  const paint = () => {
    const s = readStore();
    host.innerHTML = `
      <div class="tab-strip" role="tablist">
        ${s.tabs.map((t) => {
          const loading = isLoading(t.id);
          return `
          <div class="tab-pill ${t.id === s.activeId ? 'active' : ''} ${loading ? 'loading' : ''}"
               role="tab" draggable="true" data-id="${t.id}" title="${t.title.replace(/"/g, '&quot;')}">
            ${loading ? '<span class="tab-loading"><i data-lucide="loader-2" class="h-3.5 w-3.5 animate-spin"></i></span>' : svgIcon(t.icon)}
            <span class="tab-title">${t.title}</span>
            <span class="tab-close" data-close="${t.id}" title="Close (⌘W)">
              <i data-lucide="x" class="h-3 w-3"></i>
            </span>
          </div>
        `;
        }).join('')}
        <div class="tab-new" title="New tab (⌘T)"><i data-lucide="plus" class="h-4 w-4"></i></div>
      </div>
    `;
    drawIcons();
  };

  paint();
  const unsub = tabStore.subscribe(paint);

  host.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    if (close) { e.stopPropagation(); tabStore.close(close.dataset.close); return; }
    const nu = e.target.closest('.tab-new');
    if (nu) { tabStore.open({ hash: HOME_HASH }); return; }
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
    if (!pill || !contextMenu) return;
    e.preventDefault();
    const id = pill.dataset.id;
    contextMenu.openContextMenu(e.clientX, e.clientY, [
      { label: 'Reload', icon: 'refresh-cw', onClick: () => tabStore.reload(id) },
      { label: 'Duplicate', icon: 'copy', onClick: () => tabStore.duplicate(id) },
      { separator: true },
      { label: 'Close', icon: 'x', onClick: () => tabStore.close(id) },
      { label: 'Close others', icon: 'minus-square', onClick: () => tabStore.closeOthers(id) },
      { label: 'Close to right', icon: 'chevron-right', onClick: () => tabStore.closeToRight(id) },
    ]);
  });

  host.addEventListener('dragstart', (e) => {
    const pill = e.target.closest('.tab-pill');
    if (!pill) return;
    dragId = pill.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
  });
  host.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  host.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const target = e.target.closest('.tab-pill');
    if (!target || target.dataset.id === dragId) { dragId = null; return; }
    const all = tabStore.getAll();
    const fromIdx = all.findIndex((t) => t.id === dragId);
    const toIdx = all.findIndex((t) => t.id === target.dataset.id);
    if (fromIdx !== -1 && toIdx !== -1) tabStore.move(fromIdx, toIdx);
    dragId = null;
  });

  return paint;
}
