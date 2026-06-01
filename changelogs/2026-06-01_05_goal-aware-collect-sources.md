# Goal-aware collect: "research paper" fetches academic sources, not the 15-min sweep

**Date:** 2026-06-01
**Type:** Fix + UX Enhancement

## Summary

In the New-research-topic modal, picking a goal (e.g. **"Write a thesis / research paper"**) had **no effect on what got fetched** — the intent was only used to pick the topic's default tab. Every collect ran the same source set, so with Aggressive mode on it always did the full all-sources + historical (~15 min) sweep, even when the user only wanted papers. This wires the goal through to the collect so the thesis goal runs a fast, academic-only fetch.

## Changes

- `src/gapmap/research/intents.py`: added `COLLECT_PROFILES` + `collect_profile()` and a `collect` field on every intent (surfaced via `list_intents()`/`get_intent()`). The `thesis` goal pins `sources=arxiv,openalex,pubmed,scholar`, `skip_reddit=True`, `aggressive=False` (`~3 min`); other goals stay `None` (unchanged full-sweep behaviour).
- `app-tauri/index.html`: added a goal-driven fetch hint row (`#new-topic-collect-hint`); the Aggressive row is now id'd (`#new-topic-aggressive-row`) so it can be hidden when a goal pins its own profile.
- `app-tauri/src/main.js` (`wireModal`): caches intent presets; `applyIntentCollectProfile()` reflects the selected goal in the modal (hides Aggressive + shows "Fetches academic papers — arXiv, OpenAlex, PubMed, Scholar · ~3 min"); the start handler resolves the picked goal's `collect` profile and writes the one-shot `gapmap.collect.last_sources` / `last_skip_reddit` / `last_aggressive` keys that `collect.js` reads — overriding the Aggressive checkbox when a profile exists.
- `app-tauri/src/screens/collect.js`: friendlier activity-log source labels (`only arXiv, OpenAlex, PubMed, Google Scholar` instead of raw `skip-reddit · only arxiv,…`).
- `app-tauri/src/style.css`: `.modal-collect-hint` styling.

## Files Modified

- `src/gapmap/research/intents.py`, `app-tauri/index.html`, `app-tauri/src/main.js`, `app-tauri/src/screens/collect.js`, `app-tauri/src/style.css`

## Verification

- Python: `list_intents()` returns the `collect` profile for `thesis`, `None` for others.
- `npm run build` passes.

## Notes

- Valid `collect --sources` ids (per `cli/main.py`): hn, appstore, playstore, arxiv, openalex, pubmed, gnews, devto, stackoverflow, github, trends, scholar, github_issues, lemmy, mastodon, rss_*. semantic_scholar/crossref are paper-pipeline-only, so the thesis profile uses the 4 academic sources valid in the general collect.
- Follow-up (Phase 2): research-paper relationship map.
