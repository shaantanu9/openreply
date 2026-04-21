# Chrome-style Tab Navigation — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Chrome-style tab strip at the top of the Gap Map window so users can keep multiple screens open simultaneously with right-click context menus and full keyboard shortcuts.

**Architecture:** Pure frontend state in `localStorage` (`gapmap.tabs.v1`); a new `lib/tabs.js` module owns the store, strip rendering, and keyboard; `lib/contextMenu.js` is a reusable context-menu primitive; `main.js` router intercepts hashchange → tab focus/open.

**Tech Stack:** Vanilla JS (no framework), existing `style.css`, Lucide icons, `localStorage`.

**Spec:** `docs/superpowers/specs/2026-04-21-tab-navigation-design.md`

---

## File structure

**Create:**
- `app-tauri/src/lib/tabs.js` — store + renderer + keyboard (~400 lines, caps the feature)
- `app-tauri/src/lib/contextMenu.js` — generic menu primitive (~90 lines)

**Modify:**
- `app-tauri/src/main.js` — wire tab store into router, add new-tab / close-tab handlers
- `app-tauri/src/style.css` — append tab-strip + context-menu CSS (one appended block)
- `app-tauri/index.html` — add `<div id="tab-strip"></div>` above `<main id="main-content">`
- `app-tauri/src/screens/home.js`, `app-tauri/src/screens/topic.js`, `app-tauri/src/screens/settings.js` — sidebar + tile click interceptors (lightweight; delegate to a single `tabStore.open` call)

---

## Task 1 — Tab store (data-only, no UI yet)

**Files:**
- Create: `app-tauri/src/lib/tabs.js`

- [ ] **Step 1: Skeleton module + localStorage load/save**

```js
// app-tauri/src/lib/tabs.js
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
```

- [ ] **Step 2: Write tests first — `tests/tabs.spec.js` (manual run with node)**

```js
// Minimal — runs with `node --experimental-vm-modules tests/tabs.spec.js`
import assert from 'node:assert/strict';
import { titleForHash, iconForHash } from '../app-tauri/src/lib/tabs.js';

assert.equal(titleForHash('#/'), 'Home');
assert.equal(titleForHash('#/topic/meditation%20app'), 'meditation app');
assert.equal(titleForHash('#/collect/x'), 'Collecting · x');
assert.equal(iconForHash('#/topic/x'), 'target');
console.log('tabs title/icon tests OK');
```

- [ ] **Step 3: Public API — `tabStore` with open/close/focus**

```js
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
```

- [ ] **Step 4: Multi-close ops (others / right / reopen / reload / duplicate / move)**

```js
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
```

- [ ] **Step 5: Commit**

```bash
git add app-tauri/src/lib/tabs.js tests/tabs.spec.js
git commit -m "feat(tabs): store + title/icon resolver (no UI yet)"
```

---

## Task 2 — Context menu primitive

**Files:**
- Create: `app-tauri/src/lib/contextMenu.js`

- [ ] **Step 1: Write the module**

```js
// app-tauri/src/lib/contextMenu.js
import { refreshIcons } from '../icons.js';

let openEl = null;
function close() {
  if (!openEl) return;
  openEl.remove(); openEl = null;
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('scroll', close, true);
  window.removeEventListener('resize', close, true);
}
function onOutside(e) { if (openEl && !openEl.contains(e.target)) close(); }
function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }

/**
 * items: [{ label, icon?, onClick?, separator?, disabled? }]
 */
export function openContextMenu(x, y, items) {
  close();
  const el = document.createElement('div');
  el.className = 'context-menu';
  el.style.left = Math.max(8, x) + 'px';
  el.style.top = Math.max(8, y) + 'px';
  el.innerHTML = items.map((it, i) => {
    if (it.separator) return '<div class="context-menu-separator"></div>';
    const icon = it.icon ? `<i data-lucide="${it.icon}"></i>` : '';
    const dis = it.disabled ? ' disabled' : '';
    return `<div class="context-menu-item${dis ? ' disabled' : ''}" data-i="${i}">${icon}<span>${it.label}</span></div>`;
  }).join('');
  document.body.appendChild(el);
  openEl = el;
  // Clamp inside viewport
  const r = el.getBoundingClientRect();
  if (r.right > window.innerWidth - 8) el.style.left = (window.innerWidth - r.width - 8) + 'px';
  if (r.bottom > window.innerHeight - 8) el.style.top = (window.innerHeight - r.height - 8) + 'px';

  el.addEventListener('click', e => {
    const item = e.target.closest('.context-menu-item');
    if (!item || item.classList.contains('disabled')) return;
    const i = parseInt(item.dataset.i, 10);
    const handler = items[i]?.onClick;
    close();
    if (typeof handler === 'function') handler();
  });
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close, true);
  }, 0);
  refreshIcons?.();
}

export function closeContextMenu() { close(); }
```

- [ ] **Step 2: Commit**

```bash
git add app-tauri/src/lib/contextMenu.js
git commit -m "feat(ui): reusable context menu primitive"
```

---

## Task 3 — CSS for tab strip + context menu

**Files:**
- Modify: `app-tauri/src/style.css`

- [ ] **Step 1: Append the block at EOF**

```css
/* ─── Tab strip (Chrome-style) + context menu ─────────────────────────── */
#tab-strip { position: sticky; top: 0; z-index: 40; }
.tab-strip {
  display: flex; align-items: flex-end; gap: 2px;
  padding: 6px 10px 0;
  background: var(--surface-sunk, #F4EFEA);
  border-bottom: 1px solid var(--line);
  overflow-x: auto; -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}
.tab-pill {
  position: relative;
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  min-width: 110px; max-width: 220px;
  border: 1px solid var(--line); border-bottom: 0;
  border-radius: 8px 8px 0 0;
  background: var(--surface-2, #EFEAE4);
  font-size: 12.5px; cursor: pointer; user-select: none;
  white-space: nowrap; flex-shrink: 0;
}
.tab-pill:hover { background: var(--surface, #fff); }
.tab-pill.active { background: var(--surface, #fff); font-weight: 600; border-bottom-color: var(--surface, #fff); }
.tab-pill.active::after {
  content: ''; position: absolute; left: 10px; right: 10px; bottom: -1px;
  height: 2px; background: var(--orange, #E5614E);
}
.tab-pill svg { width: 13px; height: 13px; flex-shrink: 0; color: var(--ink-2, #4A3729); }
.tab-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.tab-close {
  opacity: 0; width: 16px; height: 16px; border-radius: 4px;
  display: inline-grid; place-items: center; cursor: pointer; flex-shrink: 0;
}
.tab-pill:hover .tab-close, .tab-pill.active .tab-close { opacity: 1; }
.tab-close:hover { background: rgba(0,0,0,.08); }
.tab-close svg { width: 12px; height: 12px; }
.tab-new {
  display: grid; place-items: center; padding: 6px 8px;
  opacity: 0.5; cursor: pointer; border-radius: 6px;
}
.tab-new:hover { opacity: 1; background: rgba(0,0,0,.04); }

.context-menu {
  position: fixed; z-index: 200;
  background: var(--surface, #fff); border: 1px solid var(--line);
  border-radius: 8px; padding: 4px; min-width: 180px;
  box-shadow: 0 12px 28px rgba(26,22,20,.18);
  font-size: 13px; color: var(--ink-1, #1a1614);
}
.context-menu-item {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 10px; border-radius: 6px; cursor: pointer;
}
.context-menu-item:hover:not(.disabled) { background: var(--surface-2, #EFEAE4); }
.context-menu-item.disabled { opacity: 0.4; cursor: not-allowed; }
.context-menu-item svg { width: 14px; height: 14px; flex-shrink: 0; }
.context-menu-separator { height: 1px; background: var(--line); margin: 4px 0; }

@media (max-width: 680px) {
  .tab-pill:not(.active) .tab-close { display: none; }
  .tab-pill { min-width: 80px; max-width: 140px; padding: 5px 8px; }
}
```

- [ ] **Step 2: Commit**

```bash
git add app-tauri/src/style.css
git commit -m "style(tabs): tab-strip + context-menu CSS with narrow-screen fallback"
```

---

## Task 4 — Mount tab strip into DOM + render

**Files:**
- Modify: `app-tauri/index.html`
- Modify: `app-tauri/src/lib/tabs.js` (add renderer)

- [ ] **Step 1: Insert host div above `<main>`**

```html
<!-- app-tauri/index.html — inside the existing .app .main column, ABOVE <main id="main-content"> -->
<div id="tab-strip" aria-label="Open screens"></div>
<main id="main-content" tabindex="-1"></main>
```

- [ ] **Step 2: Add `renderTabStrip(host)` to `tabs.js`**

```js
// Append to tabs.js
import { refreshIcons } from '../icons.js';
import { openContextMenu } from './contextMenu.js';

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
```

- [ ] **Step 3: Commit**

```bash
git add app-tauri/index.html app-tauri/src/lib/tabs.js
git commit -m "feat(tabs): render strip with context menu, click/middle-click/close"
```

---

## Task 5 — Router integration

**Files:**
- Modify: `app-tauri/src/main.js`

- [ ] **Step 1: Import + boot**

Near top of main.js:

```js
import { tabStore, renderTabStrip } from './lib/tabs.js';
import { isOnboardingComplete } from './screens/welcome.js';
```

Inside DOMContentLoaded, after `wireKeyboard()`:

```js
// Hide tab strip during onboarding
const strip = document.getElementById('tab-strip');
if (strip) {
  strip.style.display = isOnboardingComplete() ? '' : 'none';
  renderTabStrip(strip);
}
```

- [ ] **Step 2: Wire router to tabs**

Replace the existing `async function route()` with:

```js
let _lastHash = null;
async function route() {
  const hash = location.hash || '#/';
  const main = document.getElementById('main-content');

  // Save scroll of the outgoing tab before we re-render
  if (_lastHash) {
    const prev = tabStore.getActive();
    if (prev) tabStore.saveScroll(prev.id, main.scrollTop);
  }

  // Reconcile: the hash we're landing on must belong to the active tab.
  // If user clicked a sidebar link (which changed the hash directly), open
  // it in the current tab by rewriting the active tab's hash.
  const active = tabStore.getActive();
  if (active && active.hash !== hash) {
    // Check if another tab already owns this hash
    const owner = tabStore.getAll().find(t => t.hash === hash);
    if (owner) tabStore.focus(owner.id);
    else {
      // Replace current tab's hash in-place (Chrome-like default)
      const s = JSON.parse(localStorage.getItem('gapmap.tabs.v1'));
      const t = s.tabs.find(x => x.id === s.activeId);
      if (t) { t.hash = hash; t.title = titleForHash(hash); t.icon = iconForHash(hash); }
      localStorage.setItem('gapmap.tabs.v1', JSON.stringify(s));
    }
  }

  _lastHash = hash;
  const myGen = ++routeGen;
  // ... EXISTING route() body unchanged from here: for (const r of routes) ...

  // After render succeeds, update tab title + restore scroll
  const cur = tabStore.getActive();
  if (cur) {
    tabStore.setTitle(cur.id, titleForHash(cur.hash));
    requestAnimationFrame(() => { main.scrollTop = cur.scroll || 0; });
  }
}
```

Add titleForHash / iconForHash imports at top:

```js
import { titleForHash, iconForHash } from './lib/tabs.js';
```

- [ ] **Step 3: Subscribe route to active-tab changes**

```js
// After wireTabKeyboard / tab strip wiring:
tabStore.subscribe(() => {
  const active = tabStore.getActive();
  if (!active) return;
  if (location.hash !== active.hash) {
    // Focus a tab → silently update hash and re-run route() once
    history.replaceState(null, '', active.hash);
    route();
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add app-tauri/src/main.js
git commit -m "feat(tabs): router + tab store reconciliation, scroll restore"
```

---

## Task 6 — Keyboard shortcuts

**Files:**
- Modify: `app-tauri/src/main.js`

- [ ] **Step 1: Extend `wireKeyboard()`**

```js
// Inside wireKeyboard(), add handlers after existing ? / ⌘N:
document.addEventListener('keydown', e => {
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (typing && e.key !== 'Escape') return;

  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key === 't' && !e.shiftKey) {
    e.preventDefault();
    tabStore.open({ hash: '#/' });
    return;
  }
  if (meta && e.key === 'w') {
    e.preventDefault();
    const a = tabStore.getActive();
    if (a) tabStore.close(a.id);
    return;
  }
  if (meta && e.shiftKey && (e.key === 'T' || e.key === 't')) {
    e.preventDefault();
    tabStore.reopenLastClosed();
    return;
  }
  if (meta && /^[1-9]$/.test(e.key)) {
    e.preventDefault();
    const idx = parseInt(e.key, 10) - 1;
    const tab = tabStore.getAll()[idx];
    if (tab) tabStore.focus(tab.id);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add app-tauri/src/main.js
git commit -m "feat(tabs): keyboard shortcuts — ⌘T ⌘W ⌘⇧T ⌘1..⌘9"
```

---

## Task 7 — Sidebar + topic tile click interception

**Files:**
- Modify: `app-tauri/src/main.js` (add a single delegated listener at document level)

- [ ] **Step 1: Intercept cmd/middle-click on any link to a route hash**

```js
// Inside DOMContentLoaded, before await route():
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a) return;
  const href = a.getAttribute('href');
  const middle = e.button === 1;
  const meta = e.metaKey || e.ctrlKey;
  if (!middle && !meta) return;     // default click handled by hashchange
  e.preventDefault();
  tabStore.open({
    hash: href,
    foreground: e.shiftKey || middle ? !middle : true,
  });
});

document.addEventListener('auxclick', (e) => {
  if (e.button !== 1) return;       // middle click only
  const a = e.target.closest('a[href^="#/"]');
  if (!a) return;
  e.preventDefault();
  tabStore.open({ hash: a.getAttribute('href'), foreground: false });
});

// Right-click on any route link → "Open / Open in new tab"
document.addEventListener('contextmenu', (e) => {
  const a = e.target.closest('a[href^="#/"], [data-topic-href]');
  if (!a) return;
  const hash = a.getAttribute('href') || a.getAttribute('data-topic-href');
  if (!hash) return;
  e.preventDefault();
  import('./lib/contextMenu.js').then(({ openContextMenu }) => {
    openContextMenu(e.clientX, e.clientY, [
      { label: 'Open',            icon: 'arrow-right', onClick: () => { location.hash = hash; } },
      { label: 'Open in new tab', icon: 'plus-square', onClick: () => tabStore.open({ hash, foreground: false }) },
    ]);
  });
});
```

- [ ] **Step 2: Topic tiles — add `data-topic-href` so right-click targets them**

```js
// In app-tauri/src/screens/home.js, wherever topic tiles are rendered:
// Change each tile's outer element to include: data-topic-href="#/topic/<slug>"
// and make the tile a plain div (not an <a>) OR keep <a href=".."> — both work
// with the delegated listener above.
```

- [ ] **Step 3: Commit**

```bash
git add app-tauri/src/main.js app-tauri/src/screens/home.js
git commit -m "feat(tabs): intercept cmd/middle click + right-click on nav links"
```

---

## Task 8 — Drag to reorder

**Files:**
- Modify: `app-tauri/src/lib/tabs.js` (add drag handlers to `renderTabStrip`)

- [ ] **Step 1: HTML5 drag API on pills**

```js
// Inside renderTabStrip's paint(), make pills draggable:
// add draggable="true" to each .tab-pill line in the template.

// After paint(), inside the same render function:
let dragId = null;
host.addEventListener('dragstart', e => {
  const pill = e.target.closest('.tab-pill');
  if (!pill) return;
  dragId = pill.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
});
host.addEventListener('dragover', e => {
  if (!dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
});
host.addEventListener('drop', e => {
  if (!dragId) return;
  e.preventDefault();
  const target = e.target.closest('.tab-pill');
  if (!target || target.dataset.id === dragId) { dragId = null; return; }
  const all = tabStore.getAll();
  const fromIdx = all.findIndex(t => t.id === dragId);
  const toIdx   = all.findIndex(t => t.id === target.dataset.id);
  if (fromIdx !== -1 && toIdx !== -1) tabStore.move(fromIdx, toIdx);
  dragId = null;
});
```

- [ ] **Step 2: Commit**

```bash
git add app-tauri/src/lib/tabs.js
git commit -m "feat(tabs): drag to reorder within strip"
```

---

## Task 9 — End-to-end smoke test

- [ ] **Step 1: Run dev app and execute manually:**

```
npm run tauri dev
```

Then in the running app:
1. Open Topics → click a topic → it replaces current tab.
2. Cmd-click a sidebar link → opens in background tab.
3. Right-click a tab → menu opens; try Close / Close others / Duplicate / Reload.
4. Close all tabs via × → fresh Home tab appears.
5. Cmd-T → new Home tab. Cmd-W → closes it. Cmd-Shift-T → reopens.
6. Open 4 tabs, scroll each to different positions, switch between them → scroll is remembered.
7. Drag tab 2 onto tab 1 → reorders.
8. Quit the app, reopen → all tabs + active tab + scrolls restored.
9. Resize window to 680px → inactive tab close-× hides, strip scrolls horizontally.

- [ ] **Step 2: Fix anything the smoke test surfaces, then commit final polish**

---

## Task 10 — Rebuild sidecar-unrelated DMG + changelog

**Files:**
- Create: `changelogs/2026-04-21_01_tab-navigation.md`

- [ ] **Step 1: Write changelog**

```markdown
# Chrome-style tab navigation

**Date:** 2026-04-21
**Type:** Feature

## Summary
Adds a persistent tab strip at the top of Gap Map. Users keep multiple screens open, right-click for Chrome-like context menu, drag to reorder, and get full keyboard shortcuts. Tab state + scroll survive app restart.

## Files Created
- `app-tauri/src/lib/tabs.js`
- `app-tauri/src/lib/contextMenu.js`
- `docs/superpowers/specs/2026-04-21-tab-navigation-design.md`
- `docs/superpowers/plans/2026-04-21-tab-navigation.md`
- `tests/tabs.spec.js`
- `changelogs/2026-04-21_01_tab-navigation.md`

## Files Modified
- `app-tauri/index.html` — added `<div id="tab-strip">`
- `app-tauri/src/main.js` — router integration, shortcuts, click interception
- `app-tauri/src/style.css` — tab strip + context menu block
- `app-tauri/src/screens/home.js` — topic tiles gain `data-topic-href`
```

- [ ] **Step 2: Rebuild Tauri DMG (CSS-only change, incremental)**

```bash
cd app-tauri && npm run tauri build
```

- [ ] **Step 3: Final commit**

```bash
git add changelogs/2026-04-21_01_tab-navigation.md
git commit -m "docs(tabs): changelog for 2026-04-21 tab-navigation ship"
```

---

## Self-review checklist

- [ ] Every task has exact file paths
- [ ] No "TBD" / "add error handling" / "similar to above"
- [ ] Every step has either code or an exact command
- [ ] Task 5 `route()` preserves the existing route-gen logic (doesn't break the stale-render guard)
- [ ] Task 4 `renderTabStrip` subscription is idempotent — multiple subscribes don't double-paint
- [ ] Tab title resolution handles URL-encoded topic slugs
- [ ] `localStorage` write failures fail-silent (already covered by try/catch in readStore/writeStore)
- [ ] Onboarding gate hides the tab strip on first run
- [ ] The 680px breakpoint keeps tabs usable on narrow windows

---

## Execution handoff

Two options to execute:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which?
