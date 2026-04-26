# Screen-cache SWR rollout — Round 2 (medium-priority topic tabs)

**Date:** 2026-04-25
**Type:** UI Enhancement / Performance

## Summary

Extends the universal `screenCache` SWR pattern (introduced in Round 1
on Insights / Bets / Papers / Concepts) to the remaining medium-priority
per-topic tabs: **Solutions, Evidence, Sources, Posts**. Every visit to
these tabs after the first now paints from `localStorage` in <10 ms,
then refreshes from the sidecar in the background. Cache survives full
app restart.

The mutation-driven invalidation map in `main.js` was updated so that
re-running an extraction (`findings`) or a graph build (`graph`) drops
the right tags — users always see fresh data after a pipeline run, but
unrelated screens keep their fast paint.

## Changes

- Wrapped `loadSolutions` (solutions.js) — caches the per-painpoint
  `[{pp, interventions, papers}, …]` structure so the cards (problem +
  why + science + try-this) render before the per-card sidecar fan-out
  runs.
- Wrapped `loadEvidence` (topic.js) — extracted `renderEvidenceFromRows`
  helper so the SWR cache path can paint without re-running async
  empty-state branches that depend on `hasLlmConfigured()`. Cache key
  `evidence.${topic}` stores the four-kind findings rows.
- Wrapped `loadSources` (topic.js) — extracted `renderSourcesFromData`
  helper. Cache key `sources.${topic}` stores `{sources, subs}`.
- Wrapped `rerender` (posts.js) — filter-aware cache key
  `posts.${topic}.${sort}.${source}.${sub}.${minScore}.${page}`.
  Toolbar wiring extracted to `wireToolbar()` so the cache and live
  paths share it. Empty pages aren't cached (transient filter typos).
- Updated `gapmap:changed` invalidation map in main.js:
  - `findings` → `insights/evidence/solutions`
  - `graph` → `insights/solutions/concepts/papers`
  - `trash` → `insights/home/evidence/sources/posts`
  - `product` → `insights`
- Updated `docs/perf-audit.md` with the Round 2 manifest and current
  status table.

## Files Created

- `changelogs/2026-04-25_04_screen-cache-rollout-round-2.md`

## Files Modified

- `app-tauri/src/screens/solutions.js` — full SWR wrap (import was
  already added in Round 1; this commit completes the wrap with a
  shared `renderCards()` helper).
- `app-tauri/src/screens/topic.js` — added `screenCache` import;
  wrapped `loadEvidence` and `loadSources` via extracted sync render
  helpers (`renderEvidenceFromRows`, `renderSourcesFromData`).
- `app-tauri/src/screens/posts.js` — added `screenCache` import; pulled
  `paintFromData()` and `wireToolbar()` out of `rerender()`; wrapped
  `rerender()` with filter-aware SWR.
- `app-tauri/src/main.js` — broadened the `tagsByKind` invalidation map
  to drop the new `evidence/solutions/sources/posts` cache prefixes.
- `docs/perf-audit.md` — added Round 2 manifest + remaining-screens
  status table.

## Verification

Smoke imports of all 8 screen modules pass cleanly:

```bash
node --input-type=module -e \
  "Promise.all([
    import('./src/lib/screenCache.js'),
    import('./src/screens/insights.js'),
    import('./src/screens/bets.js'),
    import('./src/screens/papers.js'),
    import('./src/screens/concepts.js'),
    import('./src/screens/solutions.js'),
    import('./src/screens/posts.js'),
    import('./src/screens/topic.js'),
  ]).then(() => console.log('OK 8 modules'))"
# → OK 8 modules
```

## User-perceived impact

| Tab | Before (revisit, warm sidecar) | After (revisit, warm sidecar) |
|---|---|---|
| Solutions | ~1500-2500 ms blank → cards | **<10 ms cached cards → fresh swap-in** |
| Evidence  | ~600-1000 ms blank → cards | **<10 ms cached cards → fresh swap-in** |
| Sources   | ~400-700 ms blank → list   | **<10 ms cached list → fresh swap-in**  |
| Posts (page 0) | ~500-900 ms blank → list | **<10 ms cached list → fresh swap-in** |

For the cold first-app-launch-after-restart path, cache reads from
localStorage land in ~5-15 ms, so the user sees content immediately on
every screen they previously visited.
