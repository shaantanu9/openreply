# Audience-first banner + pipeline fixes

**Date:** 2026-05-03
**Type:** Fix

## Summary

Tightens the in-app autoresearch flow shipped earlier today by patching
five gaps caught on review:

1. **Iterate sweep override bias.** `iterate._run_audience` called
   `build_audience_personas` without `apply_overrides=False`, so iter 1
   onwards re-applied the previously-applied best config, biasing every
   later iteration in the sweep to the same parameters. Fixed by
   passing `apply_overrides=False` — the sweep now compares the grid
   cleanly. (`audience.py` already supports the kwarg from the prior
   patch.)
2. **`pipeline_status` deliberate stage.** The detection of "is this
   topic's deliberate stage ready?" was a tangled inline generator
   that re-queried the DB twice and could throw on some shapes.
   Rewrote to a single decoded `topic_insights` payload that derives
   both `synthesize` and `deliberate` stage signals from one read.
3. **Audience-first banner.** Surfaces a single dismissible banner on
   every `/topic/<T>` route when the topic has no audience clusters
   yet, with two CTAs: **Build now** → `/audience/<T>`,
   **Run pipeline** → `/improve/<T>`. Mounted via the same post-render
   hook the eye-icon uses, so no per-screen JS edits required.
   Dismissed-per-topic flag in localStorage so it never nags twice.
4. **Trash invalidates auto-build markers.** Trashing or re-creating a
   topic now clears the `gapmap.audience.autobuilt.v1` and
   `gapmap.audience.nudge.dismissed.v1` keys for that topic so a fresh
   collect retriggers the deterministic auto-build and the banner can
   show again.
5. **Sidebar order.** Promoted **Audience** above **Empathy Maps** so
   the personas-from-real-users surface lands first under Workspace.
   Order is now: Audience → Empathy → Interviews → PMF → Pricing →
   Launch → Improve → Iterate.

## Files Modified

- `src/reddit_research/research/iterate.py` — `_run_audience` now
  passes `apply_overrides=False`.
- `src/reddit_research/research/pipeline.py` — `pipeline_status`
  rewritten to single-pass over `topic_insights`.
- `app-tauri/src/main.js` — added `mountAudienceNudge` and called it
  from the post-render hook; trash/topics events now clear per-topic
  audience markers; deduped a stray duplicate explainer-slug line.
- `app-tauri/index.html` — moved Audience above Empathy Maps; added a
  longer hover title explaining "personas-from-real-users is the
  starting point for every other discovery surface."

## Verification

- `ast.parse` clean on every modified Python file.
- `node --check` clean on every modified JS file.
- `cargo check` clean.
- Final wiring sanity: 8 sidebar routes (`/audience`, `/empathy`,
  `/interviews`, `/pmf`, `/pricing`, `/launch`, `/improve`, `/iterate`)
  all resolve to their renderers in `main.js`.
