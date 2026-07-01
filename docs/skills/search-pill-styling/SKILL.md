---
name: search-pill-styling
description: "Build or fix a compact rounded search input with an icon inside a single border in the OpenReply Tauri app. Use whenever the user asks for a search box, search pill, search button, or reports that a search icon/border/padding looks wrong."
trigger: "search pill styling | fix search input | search box border | search icon alignment"
---

# search-pill-styling

Build a compact, rounded search control where a magnifier icon sits cleanly inside one continuous border.

## The pattern

Use an **absolute icon inside a relative wrapper**. Do **not** put the icon and input in a flex row — that creates a visual divider/left-border artifact.

```html
<div class="relative h-9 rounded-full border border-zinc-200 dark:border-zinc-700">
  <i data-lucide="search" class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"></i>
  <input id="ID_HERE" placeholder="Search…"
         class="h-full !min-h-0 w-28 rounded-full bg-transparent !py-0 pl-8 pr-3 text-xs outline-none placeholder:text-zinc-400 transition-all focus:w-44"/>
</div>
```

## Why this works

- `relative` wrapper owns the single rounded border.
- Icon is `absolute` and centered with `top-1/2 -translate-y-1/2`, so it never affects input layout.
- `pointer-events-none` lets clicks pass through to the input.
- `pl-8` reserves room for the icon; `pr-3` balances the right side.
- `h-9` (36 px) matches adjacent `btn` pills (`px-4 py-2 text-sm`).
- `!min-h-0 !py-0` override the global comfortable input sizing in `app-tauri/src/styles.css`.

## Sizing reference

| Adjacent control | Search wrapper height |
|------------------|-----------------------|
| `btn` (`px-4 py-2 text-sm`) | `h-9` |
| Larger form input (`min-h-[2.6rem]`) | `h-[2.6rem]` and drop the `!py-0` override |

## What to avoid

- `flex items-center gap-1` with icon + input inside one border — produces a left-section visual border.
- Forgetting `!min-h-0`/`!py-0` on compact pills — global CSS will make the input taller than the wrapper.
- Forgetting `pointer-events-none` on the icon — it can block focus/clicks on the input.

## Existing examples in the repo

- `app-tauri/src/or/shell.js` — nav search
- `app-tauri/src/or/dynamic.js` — settings search, chat history search, Daily Update digest search (`digestShell`)

Follow those examples and keep the style consistent.
