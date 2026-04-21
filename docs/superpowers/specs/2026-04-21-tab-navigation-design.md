# Chrome-style Tab Navigation — Design Spec

**Date:** 2026-04-21
**Status:** approved-for-planning
**Related:** `docs/superpowers/plans/2026-04-21-tab-navigation.md`

## 1. Goal

Let users keep multiple Gap Map screens open at once (Chrome-style tabs) so they can flip between a Topic, the Posts list, the Graph, and a Report without re-rendering each from scratch on every navigation.

## 2. Why

- Current nav replaces `main` innerHTML on every hash change. Scroll position, tab-within-topic state, and filter chips all reset. Users re-set them every time they come back.
- Investigative work needs context-switching — glance at Posts while writing a Research note, jump back to Graph to re-check a node, return to exactly where you were.
- The app's positioning is "lifecycle companion, not one-shot tool" (per `DUAL_MODE_PIVOT.md`). Daily-use tools ship tabs.

## 3. User-visible behavior

### 3.1 Tab strip

- Horizontal strip fixed at the top of the window, **above** `.topbar`.
- Each tab shows: favicon/icon for the screen type, short title (truncated with ellipsis), close ×.
- Active tab has stronger background + orange underline. Inactive tabs hover-state on hover.
- Overflow: if tabs exceed available width, strip becomes horizontally scrollable (same pattern as `.tabs` at narrow widths).

### 3.2 Opening / closing

| Gesture | Result |
|---|---|
| Click sidebar nav / topic tile | Replace current tab (default — Chrome-like) |
| Cmd-click / middle-click nav item | Open in new tab (background) |
| Cmd-Shift-click | Open in new tab (foreground) |
| Right-click nav item or topic tile | Context menu: *Open · Open in new tab · Open in new window* (window is stubbed v1 — shows "Coming soon") |
| Click × on a tab | Close it. If it was active, focus the tab to its left. |
| Right-click a tab | Context menu: *Close · Close others · Close to right · Duplicate · Reload · Pin* |
| Cmd-T | New tab at Home |
| Cmd-W | Close active tab |
| Cmd-Shift-T | Reopen last-closed tab (up to 10-deep) |
| Cmd-1 … Cmd-9 | Focus tab N |
| Drag tab | Reorder within strip |

### 3.3 Persistence

- Open tabs persist across app restart via `localStorage` key `gapmap.tabs.v1`.
- Per-tab scroll position restored on focus. Per-tab screen state (current sub-tab within Topic, filter chips, selection) also persisted into the same structure.
- If a topic was deleted while the app was closed, its tab is silently dropped on restore.

### 3.4 Fallbacks

- Minimum one tab always open. Closing the last tab opens a fresh Home tab instead.
- If `localStorage` is corrupted, start with a single Home tab and log a warning.
- If Tauri is not detected (web preview), tabs still work — they're pure frontend state.

## 4. Data model

```js
// localStorage "gapmap.tabs.v1"
{
  version: 1,
  activeId: "t_03",
  tabs: [
    {
      id: "t_01",                 // stable local ID (crypto.randomUUID or nanoid-ish)
      hash: "#/topic/meditation", // location hash to restore on focus
      title: "meditation",        // resolved on first render, refreshed when screen updates
      icon: "circle-dot",         // lucide icon name or null
      scroll: 420,                // #main-content scrollTop at last blur
      state: {},                  // per-screen serializable state (opt-in)
      pinned: false,
      createdAt: 1713600000000,
    },
  ],
  closedStack: [                  // last-closed for Cmd-Shift-T, capped at 10
    { hash: "#/posts", title: "Posts", closedAt: ... },
  ],
}
```

## 5. Architecture

### 5.1 New module — `src/lib/tabs.js`

Owns the store + rendering. Exports:

```js
export const tabStore = {
  getAll(),                  // → [{id, hash, title, ...}]
  getActive(),               // → tab or null
  open({hash, foreground=true, duplicate=false}) → tabId,
  close(tabId),
  closeOthers(tabId),
  closeToRight(tabId),
  reload(tabId),
  focus(tabId),
  move(fromIdx, toIdx),
  setTitle(tabId, title),
  saveScroll(tabId, px),
  saveState(tabId, patch),
  reopenLastClosed(),
  subscribe(cb) → unsub,     // fires on any change
};

export function renderTabStrip(host);
export function wireTabKeyboard();
```

### 5.2 Router integration (`main.js`)

Replace today's `hashchange → route()` with:

1. `hashchange` → find or open tab for the new hash.
2. Focusing a tab sets `location.hash` **without** dispatching another hashchange (use `history.replaceState` + manual render).
3. `route()` still runs the right screen into `#main-content`, but also calls `tabStore.setTitle(activeId, resolveTitleFromHash(hash))` after render.

### 5.3 Context menu — `src/lib/contextMenu.js`

Generic menu component reused for tab right-click AND nav/tile right-click.

```js
openContextMenu(x, y, items);      // items: [{label, icon, onClick, separator, disabled}]
```

Renders as absolute-positioned element, closes on outside click / Escape / window scroll. Styled to match `.modal` but smaller and anchored.

### 5.4 Sidebar + topic tile interception

- Sidebar nav links: intercept click; honour cmd/middle-click → `tabStore.open({hash, foreground: !background})`.
- Topic tiles: same handler wrapper.
- Right-click: `openContextMenu` with *Open / Open in new tab*.

### 5.5 Scroll preservation

On tab blur (about to switch away), read `#main-content.scrollTop` → `tabStore.saveScroll(activeId, px)`. On focus, restore after `route()` completes with `requestAnimationFrame`.

## 6. CSS

New section in `style.css`:

```css
.tab-strip {
  display: flex; align-items: flex-end; gap: 2px;
  padding: 6px 10px 0;
  background: var(--surface-sunk, #F7F3EE);
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}
.tab-pill {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; min-width: 100px; max-width: 220px;
  border: 1px solid var(--line); border-bottom: 0;
  border-radius: 8px 8px 0 0;
  background: var(--surface-2, #EFEAE4);
  font-size: 12.5px; cursor: pointer; user-select: none;
  white-space: nowrap;
}
.tab-pill.active { background: var(--surface); font-weight: 600; }
.tab-pill.active::after {
  content: ''; position: absolute; left: 8px; right: 8px; bottom: -1px;
  height: 2px; background: var(--orange);
}
.tab-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.tab-close {
  opacity: 0; width: 16px; height: 16px; border-radius: 4px;
  display: grid; place-items: center;
}
.tab-pill:hover .tab-close, .tab-pill.active .tab-close { opacity: 1; }
.tab-close:hover { background: rgba(0,0,0,.08); }
.tab-new {
  display: grid; place-items: center; padding: 6px 8px;
  opacity: 0.6; cursor: pointer;
}
.tab-new:hover { opacity: 1; }

.context-menu {
  position: fixed; z-index: 200;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 8px; padding: 4px; min-width: 180px;
  box-shadow: 0 12px 28px rgba(26,22,20,.18);
  font-size: 13px;
}
.context-menu-item {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 10px; border-radius: 6px; cursor: pointer;
}
.context-menu-item:hover { background: var(--surface-2); }
.context-menu-item.disabled { opacity: 0.4; cursor: not-allowed; }
.context-menu-separator { height: 1px; background: var(--line); margin: 4px 0; }
```

Narrow-screen: at `max-width: 820px` the strip already scrolls. At `max-width: 680px`, hide tab close-× except on the active tab.

## 7. Title resolution per route

| Route pattern | Title |
|---|---|
| `#/` or `#` | "Home" |
| `#/welcome` | "Welcome" |
| `#/topics` | "Topics" |
| `#/topic/:slug` | decoded slug (e.g. "meditation app") |
| `#/collect/:slug` | "Collecting · " + slug |
| `#/settings` | "Settings" |
| `#/ingest` | "Ingest" |
| `#/reports` | "Reports" |
| `#/activity` | "Activity" |
| `#/database` | "Database" |
| `#/science` | "Science" |
| `#/search` | "Search" |
| `#/find` | "Find" |
| `#/watch` | "Watch" |

Resolver lives in `tabs.js::titleForHash(hash)`.

## 8. Edge cases

- **Welcome flow first-run**: Welcome takes over the single tab; the strip is hidden until onboarding completes (controlled by `isOnboardingComplete()`).
- **Long titles**: CSS ellipsis at `max-width: 220px`. Full title shown as `title=` tooltip.
- **Duplicate tabs of the same hash**: allowed. Users explicitly asked for this via right-click Duplicate. No dedup.
- **Collecting tab + its Topic tab open simultaneously**: supported. Each renders its own screen with its own state.
- **Tab for a deleted topic**: on activate, screen renders "Topic not found" instead of erroring. User closes tab manually.
- **Persisted tabs exceed reasonable count**: soft-cap at 50. Extras dropped from tail on restore, logged to console.

## 9. Out of scope for v1

- Multi-window (separate OS-level windows via Tauri WebView create)
- Tab groups / colored categories
- Tab search (Cmd-Shift-A in Chrome)
- Syncing tab state across devices
- Drag tabs out to detach

## 10. Testing

- Open 5+ tabs including two of the same topic → all render correctly, each preserves own scroll.
- Reload the app → tabs + active tab + scroll all restored.
- Delete a topic → its tab on next app start silently disappears.
- Cmd-W closes active tab → neighbour becomes active. Close the last tab → fresh Home tab created.
- Cmd-Shift-T reopens the last closed tab with the right hash and a fresh scroll of 0.
- Right-click tab → menu appears; outside click / Escape closes it.
- Drag second tab to first position → order persists after reload.
- Narrow window to 680px → close × hides on inactive tabs; strip horizontally scrolls.

## 11. Success criteria

- No regression on existing hash navigation (deep links still work).
- First paint of the tab strip adds <20 ms to startup.
- Opening a new tab is visibly instant (<50 ms).
- Scroll restoration works without flicker.
