# Audience tab: per-persona live progress + Python incremental persistence

**Date:** 2026-05-28
**Type:** UX Fix + Backend change

## Summary

The Audience build (cluster authors → write personas) blocked the UI for 20-60s while the LLM looped through 3-7 clusters. The frontend showed a single static "Clustering authors and writing personas — this can take 20-60s when LLM is on…" line until the whole batch returned — same anti-pattern as sentiment before its fix.

Root cause: `build_audience_personas` (Python) built every persona in memory then did one `insert_all` at the end. Polling SQLite mid-run would have shown nothing because nothing had been persisted yet. Frontend then did a full `root.innerHTML = renderShell(topic, resp)` swap on completion, which also clashes with the user's "stop reloading the screen" rule.

Fix has two parts:

1. **Python — incremental persist.** `build_audience_personas` now opens the persistence layer + `DELETE FROM audience_personas WHERE topic=:topic` BEFORE the cluster loop, then `insert_all([_row_for_persist(persona)])` inside the loop right after each persona's LLM call returns. The in-memory `personas` list (sorted biggest-first) is still returned to legacy callers; the new per-iteration insert means the row lands in SQLite the moment that cluster's LLM call finishes. A `persist_incremental=False` fallback batch path preserves the original behavior if the upfront table ensure / delete fails.

2. **JS — persistent shell + append-only polling.** `buildAndRender` now mounts the build shell ONCE (header, info line, status text, skeleton grid). After that point we never reassign `root.innerHTML` — only surgical updates to `#aud-status`, `#aud-info`, `#aud-stats-host`, and individual `.aud-card-skel` swaps inside `#aud-grid`. A 1.5s polling loop calls `audiencePersonasGet(topic)` (which goes through `run_query` and is daemon-free — works even while the LLM holds the daemon mutex), filters out personas from prior runs by `generated_at`, and replaces skeleton cards with real ones as they appear. On completion: skeletons removed, statGrid + Re-build buttons injected into the existing header. No reflow, no screen blank.

The audience screen now feels like the sentiment one — real cards land one at a time as each LLM call finishes, instead of staring at a static line for the full duration.

## Changes

- `src/gapmap/research/audience.py` — moved the `_ensure_table` + `DELETE` calls above the cluster loop; added `_row_for_persist` helper; `insert_all([row])` per persona inside the loop; kept the batched insert as a fallback path when `persist_incremental` setup fails.
- `app-tauri/src/screens/audience.js` —
  - Added `renderBuildingShell(topic, { llm })` — paints the persistent build shell with skeleton cards.
  - Rewrote `buildAndRender` to poll `audiencePersonasGet` every 1.5s, dedup by `cluster_id + generated_at` against the build's start timestamp (so cached personas from a prior run don't shadow new ones), and replace skeletons in-place.
  - Surgical post-completion DOM updates only — no `root.innerHTML = renderShell(...)` reassignment.
  - Error/timeout/`ok:false` paths preserve any cards that already landed; only swap the GRID contents (not the whole screen) for the empty-error state.

## Verified

- `python3 -m ast` parses `audience.py` cleanly.
- `node --check audience.js` clean.

## Files Modified

- `src/gapmap/research/audience.py`
- `app-tauri/src/screens/audience.js`
