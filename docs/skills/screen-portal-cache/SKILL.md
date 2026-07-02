---
name: screen-portal-cache
description: "Make OpenReply Tauri app screen navigation instant by caching rendered portals per (tab, hash) and adding a Chrome-style refresh shortcut. Use when the user reports slow screen changes, page loads, or wants F5/Cmd+R refresh behavior."
trigger: "slow screen | page change slow | refresh shortcut | F5 reload | screen cache | instant navigation"
---

# screen-portal-cache

Make sidebar/hash navigation feel instant by keeping a rendered DOM portal for each (tab, hash) the user visits, and add a keyboard refresh shortcut that busts the SWR cache.

## The problem

`app-tauri/src/main.js` originally kept **one portal per tab**. Every hash change cleared that portal and re-ran the dynamic renderer, so returning to a screen you just viewed was as slow as the first visit.

## The fix

### 1. Portal key = (tabId, hash)

Replace the single-per-tab portal lookup with one lookup per (tab, hash):

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

### 2. Show/hide by both tab and hash

In `render()`, only the portal matching the active tab **and** the current hash is shown. Others are hidden but kept alive.

```js
host.querySelectorAll("div[data-tab-id]").forEach((el) => {
  const matches = el.dataset.tabId === tabId && el.dataset.hash === hash;
  el.style.display = matches ? "" : "none";
  if (matches) el.dataset.lastShown = String(Date.now());
});
```

### 3. Prune old portals to bound memory

Keep the most recent `MAX_PORTALS_PER_TAB` (e.g., 5) portals per tab and remove the rest, calling their `__orCleanup` hooks if present.

```js
function prunePortals(tabId, keepHash) {
  const host = document.getElementById("main-content");
  const portals = [...(host?.querySelectorAll(`div[data-tab-id="${CSS.escape(tabId)}"]`) || [])]
    .filter((el) => el.dataset.hash !== keepHash)
    .sort((a, b) => Number(a.dataset.lastShown || 0) - Number(b.dataset.lastShown || 0));
  while (portals.length > MAX_PORTALS_PER_TAB - 1) {
    const el = portals.shift();
    if (el.__orCleanup) { try { el.__orCleanup(); } catch (e) {} }
    el.remove();
  }
}
```

### 4. needsRender no longer depends on hash change

Because the portal is already keyed to the hash, `needsRender` is only true when the portal has never loaded or `reloadTs` changed:

```js
const needsRender = !portal.dataset.loaded || String(active.reloadTs || "") !== (portal.dataset.reloadTs || "");
```

### 5. Chrome-style refresh shortcut

Add `F5` and `Cmd/Ctrl+R` handlers. They clear the SWR cache and trigger `tabStore.reload(active.id)`, which bumps `reloadTs` and forces a re-render:

```js
function wireRefreshKeyboard() {
  if (refreshWired) return;
  refreshWired = true;
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

### 6. Tab loading indicator in the tab bar

Track which tabs are currently loading and render a spinner in place of the tab icon:

In `main.js`:

```js
const loadingTabs = new Map();
let refreshTabStrip = null;
function setTabLoading(tabId, loading) {
  const count = loadingTabs.get(tabId) || 0;
  const next = loading ? count + 1 : Math.max(0, count - 1);
  if (next > 0) loadingTabs.set(tabId, next);
  else loadingTabs.delete(tabId);
  if (refreshTabStrip) refreshTabStrip();
}
```

Toggle loading around the dynamic renderer:

```js
setTabLoading(tabId, true);
try { await DYN[key](portal); }
finally { setTabLoading(tabId, false); }
```

Pass the loader check into `renderTabStrip()` and capture its refresh function:

```js
refreshTabStrip = renderTabStrip(strip, contextMenu, {
  isLoading: (id) => loadingTabs.has(id),
});
```

In `lib/tabs.js`, replace the tab favicon with a spinning `loader-2` while `isLoading(tabId)` is true.

### 7. New tabs must load fresh, not reuse an existing tab

`tabStore.open()` deduplicates by hash by default. For "Open in new tab" actions (Cmd+click, middle-click, context menu), pass `duplicate: true` so the user gets a fresh portal with a loading skeleton:

```js
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a) return;
  const meta = e.metaKey || e.ctrlKey;
  if (!meta) return;
  e.preventDefault();
  const href = a.getAttribute("href");
  const foreground = e.shiftKey ? true : false;
  tabStore.open({ hash: href, foreground, duplicate: true });
});
```

Plain clicks still navigate the current tab and benefit from the cache.

## What this gives users

- Returning to a recently viewed screen is instant (no re-render, no re-fetch).
- Tabs show a loading spinner in the tab bar while their screen is fetching data, like Chrome.
- Opening a screen in a new tab always shows the loading skeleton and fetches fresh data.
- `F5` or `Cmd/Ctrl+R` reloads the current screen with fresh data, just like a browser.

## Files involved

- `app-tauri/src/main.js` — router, portal management, refresh shortcut, link interception, loading state
- `app-tauri/src/or/api.js` — SWR cache (`api.clearCache()`)
- `app-tauri/src/lib/tabs.js` — `tabStore.open()` / `tabStore.reload(id)`, `renderTabStrip()`
- `app-tauri/src/styles.css` — `.tab-loading` spinner styles

## Anti-patterns

- Don't cache portals indefinitely — memory grows with every unique screen visited. Prune.
- Don't skip `__orCleanup` when removing a portal — dynamic screens may have pollers/timers.
- Don't reload while the user is typing unless you intentionally want browser-like data loss.
- Don't make plain sidebar clicks open duplicates; deduplication is fine for in-tab navigation.
