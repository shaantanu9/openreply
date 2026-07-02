# Learnings — Screen portal cache + Chrome-style refresh shortcut

**Date:** 2026-06-30
**Context:** Tauri app navigation felt slow because every sidebar click re-rendered the active tab's single portal from scratch.

---

## Problem

Clicking a sidebar item to switch screens took a long time (up to a minute for heavy screens). The router in `app-tauri/src/main.js` kept only **one portal per tab**. Every hash change cleared that portal and re-ran the dynamic renderer, even when returning to a screen the user had just viewed.

The app already had an SWR read cache in `or/api.js`, but that only speeds up data fetching. The DOM was still rebuilt on every navigation, and any non-SWR / cold-sidecar work still ran.

---

## Fix

### 1. One portal per (tab, hash) — a lightweight back/forward cache

Changed `getTabPortal(tabId)` to `getPortal(tabId, hash)`. Each unique screen a tab visits gets its own persistent `<div data-tab-id="..." data-hash="...">`. When the user navigates back to a recently viewed hash, the existing portal is simply shown instead of re-rendered.

```js
function getPortal(tabId, hash) {
  const host = document.getElementById("main-content");
  if (!host) return null;
  let el = host.querySelector(`div[data-tab-id="${CSS.escape(tabId)}"][data-hash="${CSS.escape(hash)}"]`);
  if (!el) {
    el = document.createElement("div");
    el.className = "tab-view w-full max-w-6xl flex-1 px-8 py-7";
    el.dataset.tabId = tabId;
    el.dataset.hash = hash;
    host.appendChild(el);
  }
  return el;
}
```

`render()` now shows/hides portals by both `tabId` and `hash`, and prunes each tab to the most recent 5 portals to bound memory.

### 2. Chrome-style refresh shortcut

Added `F5` and `Cmd/Ctrl+R` handlers that clear the SWR cache and reload the current tab:

```js
function wireRefreshKeyboard() {
  document.addEventListener("keydown", (e) => {
    const meta = e.metaKey || e.ctrlKey;
    const isRefresh = e.key === "F5" || (meta && (e.key === "r" || e.key === "R"));
    if (!isRefresh) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;
    e.preventDefault();
    const active = tabStore.getActive();
    if (!active) return;
    api.clearCache();
    tabStore.reload(active.id);
  });
}
```

This matches the existing right-click **Reload** action on tabs, but is accessible from the keyboard like a browser.

---

### 3. Tab loading indicator in the tab bar, like Chrome

Chrome shows a spinner in the tab itself while a page loads. We added the same behavior:

- `main.js` tracks loading tabs with a reference-counted map:

```js
const loadingTabs = new Map();
function setTabLoading(tabId, loading) {
  const count = loadingTabs.get(tabId) || 0;
  const next = loading ? count + 1 : Math.max(0, count - 1);
  if (next > 0) loadingTabs.set(tabId, next);
  else loadingTabs.delete(tabId);
  if (refreshTabStrip) refreshTabStrip();
}
```

- Around the dynamic renderer in `render()`, it toggles loading:

```js
setTabLoading(tabId, true);
try { await DYN[key](portal); }
finally { setTabLoading(tabId, false); }
```

- `lib/tabs.js` `renderTabStrip()` accepts `isLoading(id)` and renders a spinning `loader-2` icon in place of the tab favicon while loading.

### 4. New tabs always load fresh, like Chrome

`tabStore.open()` deduplicates by hash by default: if a tab with that hash already exists, it focuses the existing tab. This made "Open in new tab" (Cmd+click, middle-click, context menu) behave like "switch to existing tab" instead of opening a fresh page.

Changed all new-tab open paths in `wireLinkInterception()` to pass `duplicate: true`:

```js
tabStore.open({ hash: href, foreground, duplicate: true });
```

Now a new tab always gets a fresh portal, shows the loading skeleton, and fetches its own data. Existing tab navigation and back/forward still benefit from the portal cache.

---

## Result

- Revisiting a recently-opened screen is now instant (the portal is already rendered and hidden).
- Tabs show a loading spinner in the tab bar while their screen is fetching data, like Chrome.
- Opening a screen in a new tab always shows the loading skeleton and fetches fresh data.
- Users can force a fresh fetch with `F5` or `Cmd/Ctrl+R`, just like a browser page reload.

---

## Files changed

- `app-tauri/src/main.js` — portal model, `prunePortals`, refresh shortcut wiring, new-tab link interception

## When to reuse

Any SPA router where sidebar/hash navigation re-renders heavy screens from scratch. Prefer per-hash portal caching over re-rendering when screens are expensive and revisits are common.
