# Lit-matrix build made progressive/bounded (no hang on big topics)

**Date:** 2026-06-07
**Type:** Fix

## Summary

Retesting against the real corpus (a 273-paper topic) showed the lit-matrix
"Build" would fire 273 sequential LLM calls (~30+ min) and appear to hang.
Made the build progressive + bounded: each run processes only papers that don't
yet have a row, capped at a limit (UI passes 25/click). Re-running continues
where it left off; the result reports `remaining` so the UI can say "270 more —
click Build again".

## Changes

- **`research/lit_matrix.py`** `build()`: when not `force`, select only papers
  without an existing `lit_matrix` row (score-desc), capped at `limit`. Returns
  `total_topic` + `remaining`. Transient LLM failures simply stay un-built and
  retry on the next run.
- **`screens/lit_matrix.js`**: build button passes `limit: 25` and shows
  "Built N new · M remaining — click Build again" (or "complete").

## Retest (real canonical data, topic "Brainwave meditation app…", 273 papers)

All research paths verified working end-to-end: flow-status, library, paper-read
(Reader, full text + sections), cited Q&A (grounded answer + real `[n, §section]`
citations), reading-list, and lit-matrix (real method/findings extracted). The
dev app reads/writes the canonical user DB (515M, 70,669 posts). 13 unit tests
green.

## Files Modified
- `src/gapmap/research/lit_matrix.py`, `app-tauri/src/screens/lit_matrix.js`

## Files Created
- `changelogs/2026-06-07_17_litmatrix-progressive-build.md`
