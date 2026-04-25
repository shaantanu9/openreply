# Topic header stats: instant paint from localStorage cache

**Date:** 2026-04-25
**Type:** Performance + UX

## Summary

User feedback: "stats should cache in the app itself ... I want user
see the stats the second the app open." The dashboard
(`screens/home.js`) already had a localStorage stale-while-revalidate
cache (`gapmap.dashboard.cache.v1`), so the home view paints
instantly on repeat opens. The topic page didn't. Every topic open
spawned a Python sidecar query bundle (~300-800 ms warm, 2+ s cold)
just to paint the header chips ("345 posts · 0 pains · 0 DIY · 8 src"),
leaving the header blank during that window.

This adds the same SWR pattern to `topicStats()`, keyed per topic.

## Changes

`app-tauri/src/screens/topic.js`:

- New module-level helpers `readTopicStatsCache(topic)` /
  `writeTopicStatsCache(topic, stats)` backed by localStorage with
  prefix `gapmap.topic.stats.cache.<topic>`. Best-effort — silent on
  read/write/parse failures.
- `topicStats()` now calls `writeTopicStatsCache(topic, out)` after
  every successful fetch (write-through). Failed fetches leave the
  previous cache intact so a transient sidecar timeout doesn't blank
  the chips.
- Header-stats paint logic factored into `paintTopicHeaderStats(stats,
  { cached })` — reused by both the cached first paint and the fresh
  fetch path. Stamps `data-cached="1"` on the host while showing
  stale values; cleared once the real fetch lands (lets future CSS
  fade the cached state if desired).
- Synchronous first paint runs BEFORE any `await`: the cached values
  appear in the same JS task as topic-page mount, eliminating the
  blank-header window entirely on repeat opens.
- Background refresh remains the same — `topicStats()` is called
  immediately after the cached paint and overwrites with fresh values
  when ready.

## Why localStorage (vs sessionStorage / in-memory)

The user-perceived "instant on second app launch" win comes from
cross-session persistence. sessionStorage clears on app quit;
in-memory is lost on every reload. localStorage keeps the last
observed values across launches so the header reflects real numbers
the moment the topic page mounts after a fresh boot.

## Existing dashboard cache (unchanged)

`screens/home.js` already does this for hero + stat-grid via
`writeDashCache()` / `readDashCache()`. The new topic cache mirrors
that pattern.

## Files Modified

- `app-tauri/src/screens/topic.js` — `readTopicStatsCache` /
  `writeTopicStatsCache` + write-through in `topicStats()` +
  `paintTopicHeaderStats` factor + cached-first paint.

## Verification

- `node --input-type=module -e "import('./src/screens/topic.js')"` — OK.

## Behavior

| Event | Result |
|---|---|
| First topic open ever | Skeleton until fetch lands (no cache yet) |
| Re-open same topic, same session | Instant paint from in-memory `_topicStatsPromise`, refresh in background |
| Re-open same topic, fresh app launch | Instant paint from localStorage, refresh in background |
| Topic data mutated then re-opened | Stale paint for ~few hundred ms, then real values overwrite |
| Sidecar timeout / DB lock | Cached paint stays; chips don't blank |

## Future scope

- Apply the same pattern to other heavy Tauri tab loaders (Sources,
  Trends, Sentiment) where the sidecar query is the gating factor.
- Consider reading the cache from a tiny IIFE in `index.html` so even
  the topic-page mount latency (route resolve + bundle parse) is
  hidden behind real numbers.
