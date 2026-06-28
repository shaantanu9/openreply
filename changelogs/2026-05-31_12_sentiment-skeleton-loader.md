# Sentiment tab: skeleton on cached read (loader rollout — sentiment.js)

**Date:** 2026-05-31
**Type:** UI Enhancement

## Summary

Folded `sentiment.js` into the sidebar skeleton-loader rollout. The tab already
had a full rich "Analyzing…" hero (`renderAnalyzingState`) for the 30–90s LLM
call and for in-flight auto-runs; the only remaining dead loader was the brief
(50–200ms) initial DB read, which showed a spinner + "Loading sentiment…" text.
Replaced it with `skelGrid(4,{lines:3})` matching the per-source `.sent-card`
grid that lands there — consistent with how concepts/solutions/empathy handle
their cached-read path. The Run / Re-run buttons already hand off to the rich
hero, so no busy-wrap was needed.

`topic.js` remains deferred: it currently has a large uncommitted diff from a
parallel work-stream, so it is not safe to edit without colliding with / sweeping
that in-progress work.

## Files Modified

- `app-tauri/src/screens/sentiment.js` — `skelGrid` import; cached-read dead
  loader → `skelGrid(4,{lines:3})`.

## Verification

- `node --check src/screens/sentiment.js` → OK.
- `npm run build` (vite) → ✓ built.
