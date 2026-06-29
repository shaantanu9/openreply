# Tailwind local bundle + CSP hardening (drop unsafe-eval)

**Date:** 2026-06-29
**Type:** Infrastructure

## Summary

Replaced the Tailwind JIT CDN (`cdn.tailwindcss.com`) with a locally-bundled
Tailwind v3 build so the app's Content-Security-Policy can drop `'unsafe-eval'`
and three CDN hosts. `'unsafe-eval'` was required only by the Tailwind CDN's
in-browser JIT compiler — not by Lucide — so bundling Tailwind at build time
removes the need for it entirely. Lucide stays on the unpkg CDN (it does not
require `'unsafe-eval'`). The build was verified: the 41 KB compiled CSS
contains every critical class, including the brand colors, the arbitrary-value
grid tracks (`grid-cols-[minmax(0,1fr),…]`), the safelisted dynamic KPI grids
(`lg:grid-cols-3/4`), and the new layout utilities (`max-h-[85vh]`, `min-w-0`,
`overflow-x-auto`).

## Changes

- Added Tailwind v3 + PostCSS + Autoprefixer as dev dependencies and a
  `tailwind.config.js` / `postcss.config.js` so Vite compiles Tailwind locally.
- Content globs scan `./index.html` and `./src/**/*.{js,html}` (the app builds
  class strings inside template literals). The only interpolated class name —
  `lg:grid-cols-${n}` in `skeleton.js` — is safelisted as `lg:grid-cols-3/4`
  since the content scanner cannot see interpolated fragments.
- Created `src/styles.css` (`@tailwind base/components/utilities`) and migrated
  the form-control polish that previously lived in the `index.html` inline
  `<style>` block into an `@layer base` block there. `main.js` imports it.
- Removed from `index.html`: the `cdn.tailwindcss.com` `<script>`, the inline
  `tailwind.config`, and the inline `<style>`. Kept: the pre-paint theme script,
  Google Fonts, and the Lucide unpkg `<script>`.
- Hardened the CSP in `tauri.conf.json`:
  - `script-src`: `'self' 'unsafe-inline' https://unpkg.com`
    (dropped `'unsafe-eval'`, `cdn.tailwindcss.com`, `d3js.org`,
    `cdnjs.cloudflare.com` — the latter two were dead entries no file referenced).
  - `style-src`: `'self' 'unsafe-inline' https://fonts.googleapis.com`
    (dropped `cdn.tailwindcss.com`).

## Verification

- `npm run build` succeeds → `dist/assets/main-*.css` (41.42 kB / 8.44 kB gzip).
- dist CSS contains: `bg-reddit`, `text-reddit`, `accent-reddit`,
  `bg-reddit-hi`/`hover:bg-reddit-hi`, `bg-brand`, `text-brand`,
  `minmax(0` (×11), `lg:grid-cols-3`, `lg:grid-cols-4`, `overflow-x-auto`,
  `max-h-[85vh]`, `min-w-0`, Inter `font-family`.
- `dist/index.html`: 0 Tailwind CDN script tags, 1 Lucide unpkg script, 1
  bundled CSS link.
- `tauri.conf.json` remains valid JSON.

## Files Created

- `app-tauri/tailwind.config.js`
- `app-tauri/postcss.config.js`
- `app-tauri/src/styles.css`

## Files Modified

- `app-tauri/package.json` — added `tailwindcss@^3.4.17`, `postcss@^8.4.49`,
  `autoprefixer@^10.4.20` dev dependencies.
- `app-tauri/package-lock.json` — lockfile for the above (via `npm install`).
- `app-tauri/src/main.js` — `import "./styles.css"`.
- `app-tauri/index.html` — removed Tailwind CDN script + inline config + inline
  style; kept theme script, fonts, Lucide CDN.
- `app-tauri/src-tauri/tauri.conf.json` — CSP `script-src`/`style-src` hardened.
