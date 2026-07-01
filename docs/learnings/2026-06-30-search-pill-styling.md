# Learnings — Compact rounded search pill styling

**Date:** 2026-06-30
**Context:** Daily Update card in the Tauri app (`app-tauri/src/or/dynamic.js`, `digestShell`).

---

## Problem

The Daily Update search control looked off: the search icon was not sitting cleanly inside the rounded border, and a visual "left border" / divider appeared between the icon area and the input text.

Initial attempt used a flex row inside the pill:

```html
<div class="flex items-center gap-1 rounded-full border ... px-2 py-1">
  <i data-lucide="search" class="h-3.5 w-3.5 text-zinc-400"></i>
  <input ... class="w-28 bg-transparent text-xs ..."/>
</div>
```

This creates two common problems:
1. The icon and input are separate flex children, so the eye reads a split between them — looks like a left section with its own edge.
2. The global form CSS (`styles.css`) forces `min-height: 2.6rem` and `padding: 0.55rem 0` on inputs, which fights a compact pill height and pushes vertical alignment off.

---

## Fix pattern

Use the same pattern already established elsewhere in the app (sidebar nav, settings, chat history): **absolute icon, relative wrapper, input padding reserves space for the icon**.

```html
<div class="relative h-9 rounded-full border border-zinc-200 dark:border-zinc-700">
  <i data-lucide="search" class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"></i>
  <input id="ov-digest-search" placeholder="search news…"
         class="h-full !min-h-0 w-28 rounded-full bg-transparent !py-0 pl-8 pr-3 text-xs outline-none placeholder:text-zinc-400 transition-all focus:w-44"/>
</div>
```

Key details:
- `relative` wrapper carries the single rounded border.
- Icon is `absolute left-3 top-1/2 -translate-y-1/2` and `pointer-events-none` so it floats over the input without stealing clicks.
- Input gets `pl-8` so the placeholder/typed text starts after the icon.
- `h-9` on the wrapper matches the adjacent `Refresh now` button (`px-4 py-2 text-sm` ≈ 36 px).
- `!min-h-0 !py-0` overrides the global comfortable input sizing for this compact control.

---

## When to reuse

Any compact, rounded search pill in the Tauri frontend where the icon must sit cleanly inside one continuous border. Check existing implementations in `app-tauri/src/or/shell.js`, `app-tauri/src/or/dynamic.js` (settings, chat history), and prefer this absolute-icon pattern over a flex row with icon + input.

---

## Reference

- File: `app-tauri/src/or/dynamic.js`
- Function: `digestShell()` inside `renderOverview()`
- Related global styles: `app-tauri/src/styles.css` (input min-height / padding rules)
