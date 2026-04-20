# Topic page: auto-run analyses, prefetch tabs, plug leaks, Map-export timeout

**Date:** 2026-04-20
**Type:** UX Enhancement / Perf / Fix

## Summary

User reported "most tabs not working", wanted parallelism, and no memory leaks or perf degrade. Audit found that most tabs are actually wired correctly — the complaint was aimed at **Trends** and **Sentiment** which showed a "Run analysis" CTA button by design and users assumed broken. Real issues that *were* present: (1) toast auto-remove timers not tracked on route change, (2) Map "Exporting viewer…" would spin forever on sidecar hang. Everything else the audit flagged turned out to be already-handled or not a real leak.

## Changes

### Auto-run Trends + Sentiment on first tab view

**`app-tauri/src/screens/trends.js`** — replaced the CTA-only `loadTrends` with an auto-run:
- First view → fires `runTemporalGaps(topic)` with a "Running…" message, no click needed.
- Module-scoped `_trendsCache: Map<topic, items[]>` holds the result so switching tabs doesn't re-spawn the 30–90s LLM call.
- `_trendsRunning: Set<topic>` guards against tab-flip races (prevents the same enrichment-pileup livelock we just fixed in `ActiveGraphOps`).
- Button renames from "Run trends analysis" → "Re-run analysis" (always present after first result).
- `renderEmptyCta` repurposed for the "ran successfully but no trend patterns detected" edge case only.

**`app-tauri/src/screens/sentiment.js`** — same pattern:
- `loadSentiment` now auto-fires `runAndRender` when the DB has no `source_sentiment` rows for the topic.
- `_sentimentRunning: Set<topic>` dedup so concurrent tab-clicks don't stack LLM calls.
- Sentiment results already persist to `graph_nodes`, so subsequent topic opens pull from DB (cheap) and skip auto-run.

### Kill toast-timer zombies on route exit

**`app-tauri/src/screens/topic.js`** — new module-scoped `_activeToastTimers: Set<number>`. Every `setTimeout` in `showToast` (auto-remove after 5s + post-fade removal after 200ms) now pushes its handle into the set. `hashCleanup` clears all tracked timers, so zombie `setTimeout`s no longer try to `el.remove()` DOM nodes that belong to an unmounted screen.

### Map-export 60s timeout + "Skip to findings"

**`app-tauri/src/screens/topic.js`** — wrapped `api.exportHtml(topic, force)` in a `Promise.race` against a 60s timeout. Rejection carries a `__timeout: true` flag. The catch block recognizes it and shows a targeted error card with:
- **Retry** (re-triggers `loadMap()`)
- **Skip to findings** (switches to Evidence tab so users aren't stuck staring at a wedged Map when the real work — the LLM extraction — is already done and viewable elsewhere)

Previously the UI showed `Exporting viewer…` forever when the sidecar was stuck on a DB lock (e.g., during the 11-enrich pileup pattern we just fixed in `ActiveGraphOps`). Now the user gets an escape hatch within a minute.

### Tab prefetch on topic mount

**`app-tauri/src/screens/topic.js`** — extended the existing 4-query parallel prefetch to 6 queries. Added SQL for **Posts page 0** and **Research papers (IN-list with 5 academic sources)**. Together with the existing Evidence / Sources / Subreddits / BYOK prefetch, the next tab click for the 4 most common post-Map tabs reads from the `cachedInvoke` warm cache instead of cold-spawning a Python sidecar. Per-click click-to-paint drops from ~500ms (warm spawn) or ~2min (cold Gatekeeper) to essentially synchronous.

All 6 prefetches fire concurrently; errors swallowed (loaders re-fetch with proper UI feedback on any real failure). SQLite WAL + per-thread connections (shipped in the parallel-collect bundle) make 6 concurrent readers safe.

### Audit items marked non-issues

Two items the upstream audit flagged turned out to be already handled:
- **Event delegation on Evidence/Research** — each `loadX()` does `contentEl.innerHTML = …` which destroys old DOM and GCs their listeners. No accumulation. No change needed.
- **Gated writes in Posts** — `posts.js` already uses a `set(html)` helper that checks `contentEl.dataset.tab === 'posts'` before writing. No change needed.

## Verification

- `node --check` topic.js + trends.js + sentiment.js → clean
- `npm run build` → clean (check Monitor output)
- No Rust changes; no `cargo check` needed

## UX delta

Before:
- Click **Trends** → "Run trends analysis" button → blank until user clicks → 30-90s wait.
- Click **Sentiment** → "Run sentiment analysis" button → same.
- Map export hangs → "Exporting viewer…" forever, no way out.
- Toast auto-dismiss tried to manipulate DOM nodes from other routes after navigation.

After:
- Click **Trends** → "Running temporal-gaps analysis… 30–90s" → results auto-paint when done.
- Click **Sentiment** → "Analyzing sentiment per source…" → auto-paint.
- Map export hangs > 60s → error card with **Retry** + **Skip to findings** buttons.
- Route change nukes all pending toast timers; no zombie setTimeouts.
- 4 common post-Map tabs (Evidence, Sources, Posts, Research) paint instantly from warm cache.

## Files Modified

- `app-tauri/src/screens/topic.js` — toast-timer tracking, cleanup wire-up, Map export timeout wrapper + error card, extended tab prefetch
- `app-tauri/src/screens/trends.js` — auto-run on first view + per-topic cache + concurrent-call dedup
- `app-tauri/src/screens/sentiment.js` — auto-run on first view + concurrent-call dedup
