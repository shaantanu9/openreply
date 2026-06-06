# Sentiment-by-source comparison chart: readable source names

**Date:** 2026-06-06
**Type:** Fix | UI Enhancement

## Summary

The Sentiment tab's "Sentiment by source" comparison chart (the documented 🟡 gap, since
addressed in `renderSourceChart`) and the per-source cards were labeling each source with the
wrong string. `fetchSentimentData` spread the `metadata_json` blob over the SQL row, and that
blob carries its own `label` field holding the SENTIMENT word ("positive"/"neutral"/
"mixed"/"negative"). The spread overwrote the SQL `label` column — which is the human-readable
SOURCE name ("Reddit", "App Store reviews", "Google News") — so both the chart bars and card
titles rendered the slug ("appstore") or the sentiment word ("mixed") instead of the real
source name. Verified against the live `graph_nodes kind='source_sentiment'` rows in the
desktop DB.

## Changes

- `fetchSentimentData` now preserves the readable source name as a dedicated `source_name`
  field while still letting `meta.label` (the sentiment word) win for `s.label` — so
  `renderCard`'s tone lookup (`SENTIMENT_TONE[s.label]`) is unchanged.
- `renderSourceChart` bar labels now use `s.source_name` (fallback slug → label → "?"),
  so the comparison reads "App Store reviews" / "Google News" instead of "appstore" / "gnews".
- `renderCard` title now uses `s.source_name` for the same reason (was showing the sentiment
  word as the card heading).
- No changes to the run button, analyzing/loader state, live polling, empty CTA, exported
  function names/signatures (`loadSentiment`, `sentimentLoaderProgress`, `SENT_STAGES`), or
  api.js/topic.js wiring.

## Files Modified

- `app-tauri/src/screens/sentiment.js` — preserve `source_name` in `fetchSentimentData`; use
  it in `renderSourceChart` bar labels and the `renderCard` title.

## Verification

- `node --check app-tauri/src/screens/sentiment.js` → OK
- `node --test app-tauri/src/screens/sentiment.progress.test.mjs` → 5/5 pass
- Sort + bar-width derivation sanity-checked against real 4-source data (most-positive →
  most-negative ordering, neutral/mixed get a 22% stub bar).
