# Bundle Tailwind CSS + Lucide icons locally (fix unstyled packaged app)

**Date:** 2026-06-29
**Type:** Fix

## Summary

The packaged macOS app rendered completely unstyled — no CSS, no icons — on
every machine (including the dev's own, when run from the DMG). Root cause:
`app-tauri/index.html` loaded Tailwind from the runtime JIT CDN
(`https://cdn.tailwindcss.com`) and Lucide from `https://unpkg.com`, neither of
which was bundled into the app. The Vite build copied those `<script>` tags
through verbatim, so the production webview depended on those CDNs applying
styles at runtime — which failed in the packaged build, leaving the UI with no
utility classes and no icons. Fixed by compiling Tailwind to a local stylesheet
and bundling Lucide via npm, removing all runtime CDN style/icon dependencies.

## Changes

- Added a real Tailwind v3 toolchain to `app-tauri` (`tailwindcss`, `postcss`,
  `autoprefixer` as devDependencies).
- `tailwind.config.js`: `darkMode: 'class'`, content globs over `index.html`,
  `splash.html`, and `src/**/*.js` (the entire UI is rendered as HTML
  template-literals inside JS, so the JS files MUST be scanned), and the theme
  ported from the old inline config (`reddit` color scale, `brand`, Inter →
  system-ui font stack).
- `postcss.config.js`: tailwindcss + autoprefixer.
- `src/styles.css`: `@tailwind base/components/utilities` + the form-control
  polish CSS moved out of the inline `<style>` in index.html.
- `src/main.js`: `import './styles.css'` and bundle Lucide —
  `import { createIcons, icons } from 'lucide'` then re-expose
  `window.lucide = { createIcons: (opts) => createIcons({ icons, ...opts }) }`
  so the existing `window.lucide.createIcons()` call-sites work unchanged.
- `index.html`: removed the Tailwind CDN `<script>`, the inline `tailwind.config`,
  the unpkg Lucide `<script>`, the Google Fonts links, and the inline `<style>`.
- `src/or/shell.js`: `ensureLucide` no longer lazy-injects the unpkg CDN script
  (Lucide is now always present via the bundle) — reduced to `cb()`.
- `src-tauri/tauri.conf.json`: tightened CSP — dropped `cdn.tailwindcss.com`,
  `unpkg.com`, `fonts.googleapis.com`, `fonts.gstatic.com` from
  script-src/style-src/font-src now that nothing loads from them.

## Verification

- `npm run build` emits `dist/assets/main-*.css` (41 KB) linked in
  `dist/index.html`; no live CDN references remain.
- Confirmed dynamic classes that exist only in JS strings compiled in:
  `bg-reddit`, `text-reddit`, `z-[60]`, `top-1/2`, `-translate-y-1/2`,
  `h-3.5`, `sm:col-span-2`, dark-mode variants, Tailwind preflight + `--tw-`
  vars, and the moved `#navSearch` / `#agentSel` rules.

## Files Created

- `app-tauri/tailwind.config.js`
- `app-tauri/postcss.config.js`
- `app-tauri/src/styles.css`
- `changelogs/2026-06-29_09_bundle-tailwind-lucide-locally.md`

## Files Modified

- `app-tauri/index.html` — removed all CDN script/style/font tags
- `app-tauri/src/main.js` — import styles.css + bundle Lucide global
- `app-tauri/src/or/shell.js` — `ensureLucide` no longer injects unpkg CDN
- `app-tauri/src-tauri/tauri.conf.json` — tightened CSP (removed CDN hosts)
- `app-tauri/package.json` / `package-lock.json` — added Tailwind toolchain
