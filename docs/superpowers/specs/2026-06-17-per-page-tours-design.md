# Per-Page First-Open Tutorials + Replay Shortcut (Design)

> **Status:** Approved for implementation · **Date:** 2026-06-17 · **App:** Gap Map (`reddit-myind`, Tauri + vanilla JS)

## 1. Summary

On the **first open of every page** (top-level routes *and* the topic-detail
tabs), auto-run a short **spotlight tour** that demos what the page does and its
key actions. Every page is covered: ~10 core pages get hand-authored multi-step
tours; all other pages auto-generate a tour from the existing backend
page-explanations. The existing **`?`** shortcut modal gains a top **"Tour this
page"** item so users can replay the current page's tour anytime.

This is a thin coordinator layer over infrastructure that already exists —
`lib/tour.js` (spotlight engine), `lib/tours.js` (registry + getting-started),
`lib/helpPopover.js` (eye-icon "Show me around"), the `route()` dispatcher, and
`screens/topic.js::switchTab()`. No new overlay engine, no backend changes.

## 2. Goals / Non-Goals

**Goals**
- First open of any page auto-runs its tour exactly once (tracked in localStorage).
- Every page has *something*: hand-authored tour → else auto-tour from
  `api.pageExplanationGet(slug)` → else nothing (no crash, menu says "no tour yet").
- `?` opens the shortcuts modal with **"🎓 Tour this page"** at the top (replay,
  `force`). The eye-icon "Show me around" routes to the same replay.
- A Settings toggle to disable auto-tours (default on).

**Non-Goals (YAGNI)**
- ❌ New overlay/coachmark engine — reuse `lib/tour.js`.
- ❌ Backend changes / new page-explanation content endpoints.
- ❌ Rewriting the getting-started onboarding tour.
- ❌ Per-page tour analytics.
- ❌ Hand-authoring all ~50 pages now (explanation fallback covers the rest).

## 3. Architecture

New module **`app-tauri/src/lib/pageTours.js`**:

```
pageKeyForHash(hash)            -> stable key for a top-level route   ("papers", "settings", "empathy")
pageKeyForTab(topic, tabName)   -> stable key for a topic tab         ("topic:papers", "topic:academic")
PAGE_TOURS                      -> { <key>: [step, ...] }  hand-authored core tours
PAGE_SLUG                       -> { <key>: <explanation-slug> }  for the auto fallback
resolvePageTour(key, ctx)       -> async: steps[] | null  (hand-authored -> explanation -> null)
maybeAutoRunPageTour(key, ctx)  -> async: first-open auto-run, guarded
runPageTour(key, ctx, {force})  -> async: explicit replay
currentPageKey()                -> key for the page on screen now (hash + active topic tab)
autoToursEnabled()/setAutoTours -> Settings toggle accessor (gapmap.pref.auto_tours)
```

Tour id namespace: **`page.<key>`** → done flag `gapmap.tour.page.<key>.done`
(set by the existing engine on completion/dismiss).

### Resolve precedence (`resolvePageTour`)
1. `PAGE_TOURS[key]` (hand-authored multi-step) — used as-is.
2. Else `api.pageExplanationGet(PAGE_SLUG[key] || key)` → build a 1-2 step tour:
   a centered intro step (title + plain summary) + an optional "Things you can do"
   step from the `do[]` list. Tolerant of missing fields; returns null if the
   explanation is empty/errors.
3. Else `null`.

### Auto-run guards (`maybeAutoRunPageTour`)
Run only when ALL hold:
- `autoToursEnabled()` is true;
- onboarding is complete AND hash is not `welcome`/`activate`/`license`;
- no tour is currently active (`isTourActive()` — small addition to `tour.js`);
- `!isTourDone('page.'+key)`;
- a tour resolves (non-null).
Fire after the render settles: schedule on a microtask/short timeout and re-check
the page is still current (mirror the route's `routeGen` stale-guard / verify
`currentPageKey() === key`). Never throw into the caller (best-effort).

## 4. Hook points (3 small edits + 2 wiring)

| File | Location | Change |
|---|---|---|
| `main.js` | `route()` after successful render (~:493) | `maybeAutoRunPageTour(pageKeyForHash(hash), { root: main })` |
| `screens/topic.js` | `switchTab()` after loader kickoff (~:4750) | `maybeAutoRunPageTour(pageKeyForTab(topic, name), { topic })` |
| `main.js` | `openShortcutsHelp()` (the `?` modal, ~:1756) | Inject top item **"🎓 Tour this page"** → `runPageTour(currentPageKey(), {force:true})`; + "Replay getting-started" |
| `lib/helpPopover.js` | "Show me around" button | Route to `runPageTour(currentPageKey(), {force:true})` so it works on all pages |
| `lib/tour.js` | — | Add `export function isTourActive()` (reads existing root presence) |
| `settings.js` | Preferences section | Toggle "Auto-show page tours" ↔ `gapmap.pref.auto_tours` (default on) |

## 5. Core pages hand-authored (~10)

`home`, `topic:home`, `topic:map`, `topic:papers`, `topic:academic`,
`topic:research`, `settings`, `reports`, `chats`, `collect`. Each: 3-5 steps,
plain-text bodies, selectors that exist in that screen's DOM (verified against
the render output); steps with no selector render as centered cards.

## 6. Persistence / keys

- `gapmap.tour.page.<key>.done` — per-page seen flag (engine-managed).
- `gapmap.pref.auto_tours` — `'false'` disables auto-run (default on / absent).
- Reuses existing `gapmap.onboarding.completed` for the onboarding guard.

## 7. Error handling / degradation

| Case | Behavior |
|---|---|
| `api.pageExplanationGet` errors / empty | resolve returns null → no auto-run; menu item shows "No tour for this page yet" |
| Hand-authored selector missing in DOM | engine already centers a step with no anchor; tour still runs |
| Rapid navigation | stale-guard: re-check `currentPageKey()===key` before starting |
| Tour already active | auto-run skipped; replay via menu ends the active one first |
| Auto-tours disabled | first-open does nothing; `?` menu replay still works |

## 8. Testing

`app-tauri/src/lib/pageTours.test.mjs` (node:test, offline; mock `localStorage`,
the `tour.js` engine, and `api.pageExplanationGet`):
- `pageKeyForHash` / `pageKeyForTab` map representative inputs correctly.
- `resolvePageTour` precedence: hand-authored → explanation-built → null.
- `maybeAutoRunPageTour` respects: done flag, onboarding-incomplete, disabled
  pref, active-tour, and stale page key (each independently suppresses).
- `runPageTour({force})` starts even when done flag is set.
Add the test to `app-tauri/package.json`'s test list.

## 9. Build / rollout

1. `lib/pageTours.js` + `lib/tour.js::isTourActive` + test. `npm test` green.
2. Wire the 3 hooks + helpPopover + Settings toggle. `npm run build` green.
3. Author the ~10 core tours; smoke-check selectors against each screen.
4. Changelog + (no FEATURES.md feature change needed beyond a UX note).

## 10. Open questions (resolved)

1. First-open behavior → **auto-run full tour**, once per page. ✅
2. Shortcut → **`?` modal gains "Tour this page"** (replay current page). ✅
3. Coverage → **hybrid**: explanation fallback for all, hand-author ~10 core. ✅
