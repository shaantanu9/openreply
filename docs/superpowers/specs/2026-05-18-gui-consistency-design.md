# App GUI — Consistency + UX Flow Pass

**Date:** 2026-05-18
**Status:** Approved — implementing
**Surface:** Tauri desktop app (`app-tauri/`). CLI and MCP passes follow as separate specs.

## Problem

The Tauri app has a partial design system: `style.css` defines color, radius,
shadow, and page-rhythm tokens — but there is **no spacing scale** and only a
3-size type scale, so ~1,142 hardcoded `px` padding/margin values bypass the
tokens. There are **no shared layout primitives**: each of the 44 screens
hand-rolls its own header, empty state, loading state, and error display. The
result is inconsistent padding/spacing and an inconsistent user journey.

## Goal

Visual consistency **and** uniform UX flow, **without** changing the visual
look (no new colors, no layout redesign).

## 1. Design tokens (`app-tauri/src/style.css` `:root`)

Add an 8pt spacing scale:

```
--space-1:4px  --space-2:8px  --space-3:12px  --space-4:16px
--space-5:24px --space-6:32px --space-7:48px  --space-8:64px
```

Extend the type scale to a full set: `--fs-11 --fs-12 --fs-13 --fs-14
--fs-15 --fs-17 --fs-20 --fs-24`.

Re-express the existing semantic tokens in terms of `--space-*`, snapped to
the grid (each shift ≤4px, imperceptible per-value):

| Token | Old | New |
|---|---|---|
| `--page-pad-x` | 28px | `var(--space-6)` 32px |
| `--page-pad-y` | 22px | `var(--space-5)` 24px |
| `--page-pad-bottom` | 44px | `var(--space-7)` 48px |
| `--block-gap` | 18px | `var(--space-4)` 16px |
| `--block-gap-lg` | 24px | `var(--space-5)` 24px |
| `--block-gap-sm` | 14px | `var(--space-3)` 12px |
| `--card-pad-x` | 22px | `var(--space-5)` 24px |
| `--card-pad-y` | 20px | `var(--space-5)` 24px |

Existing token names stay valid — screens that already use them are unaffected
beyond the ≤4px snap.

## 2. Shared primitives — `app-tauri/src/components/`

Plain render-functions, matching the existing screen idiom (HTML-string /
DOM-returning helpers). Each ships with a `*.test.mjs` node:test file.

- **`PageShell.js`** — `pageShell({title, subtitle?, actions?, body})` →
  returns the standard page container + `PageHeader` (title left, action
  buttons right, optional subtitle line). One uniform header for every screen.
- **`EmptyState.js`** — `emptyState({icon?, title, message?, cta?})`.
  Consolidates `lib/empty.js` + `lib/tabEmpty.js` behind one API; the old
  modules become thin re-export shims so nothing breaks mid-migration.
- **`LoadingSkeleton.js`** — `skeleton({rows?, variant?})` → shimmer
  placeholder (`variant`: `list` | `card` | `table`).
- **`ErrorCard.js`** — `errorCard({title?, message, retry?})` → uniform error
  display with optional retry button.

## 3. Migration — all 44 screens

Per screen: hardcoded `px` → tokens; hand-rolled header → `pageShell`;
empty/loading/error → the primitives. Done in **6 batches of ~7-8 screens**,
each its own commit + changelog. Core/high-traffic screens first; the 11
"partial" screens from `FEATURES.md` (which gain proper empty/loading/error
states) last.

Batch order (by area, smallest-risk first):
1. Simple screens: `home_tab, search, sentiment, why, prd, global_competitors, find, compare`
2. List/data screens: `posts, papers, database, activity, collects, concepts, trends, tasks`
3. Research screens: `insights, audience, launch, reports, solutions, science, empathy, watch`
4. Analysis screens: `ost, kano→pricing, pmf, intent_ladder, estimate, improve, iterate, interviews`
5. Big screens: `home, collect, personas, product, settings, byok, welcome, topic`
6. Remaining + the 11 partial screens, mop-up.

## 4. Testing & verification

- `npm test` + `npm run build` green **after every batch** (hard gate).
- Unit tests for all 4 primitives (`components/*.test.mjs`).
- `scripts/check_css_consistency.sh` — greps `style.css` for stray hardcoded
  `padding:`/`margin:` px values; fails if the count rises above the agreed
  ceiling. Run in CI + before each batch commit.
- `cargo check` unaffected (no Rust changes).

## 5. Non-goals

- No color / visual redesign — the look stays identical.
- No layout restructuring beyond the uniform header + state components.
- No dead-CSS elimination (tokenize in place).
- CLI and MCP consistency passes are **out of scope** — separate specs.

## Risk

A 44-screen migration is large. Mitigated by 8-screen batches, each
independently tested and committed, so any batch can be reviewed or reverted
in isolation. The foundation (tokens + primitives) lands and is verified
before any screen is touched.
