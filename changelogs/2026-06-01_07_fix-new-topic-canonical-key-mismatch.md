# Fix: new-topic papers/posts invisible after collect (canonical topic-key mismatch)

**Date:** 2026-06-01
**Type:** Fix

## Summary

When a user created a **new topic** (including the "research paper" goal,
which fetches from academic sources) and ran a collect, the fetched papers and
posts often did not appear under the topic — it looked empty even though the
collect succeeded. Root cause: `collect()` runs the topic through an LLM
**canonicalize** step and stores everything under the *canonical* form, but the
UI continued to show, build the graph for, and navigate to the *user-typed*
form. Every read query (`papers_list_native`, `list_topics`, `topic_graph_summary`)
matches the topic name literally with no alias resolution, so the freshly
collected topic appeared to have no papers/posts under the name the user saw.

This was **not** a DB problem and **not** a papers-feature problem — the data
was written correctly, just under a different key than the one being read.

Two defects fixed:

1. **`collect.py` never registered the user-typed → canonical alias.** The code
   intended to bind the typed form to the canonical (so future searches and
   reads resolve), but it overwrote the `topic` variable with the canonical
   *before* the `register_alias` calls, so it only ever bound canonical →
   canonical. The typed form never resolved.

2. **The Collect screen ran the entire post-collect pipeline on the typed
   key.** `buildGraph`, `enrichGraph`, `exportHtml`, the insights refresh, and
   the "Open topic" button all used the typed topic, so the graph built on an
   empty corpus and the topic opened empty.

## Changes

- `collect.py`: capture the original typed topic before reassigning, and
  register `original_typed → canonical` (plus the canonical self-anchor) so
  `resolve_topic(typed)` now returns the canonical. Verified end-to-end:
  `zzxq mycology spore print identification app` → canonical
  `mycology spore print identification app`, 178 papers tagged under the
  canonical, and both loose + slug aliases of the typed form now resolve.
- `collect.js`: introduced a screen-scoped `storageTopic` plus an
  `adoptCanonical()` helper that mirrors `collect.py`'s gating (canonical wins
  only on `high`/`low` confidence). The recon card already canonicalizes the
  topic; we now capture that result. On collect completion the graph build,
  enrichment, HTML export, insights refresh, and the "Open topic" navigation
  all operate on — and route to — `storageTopic`, so the user lands on the
  populated canonical topic. The running-collect lifecycle (`_collectStatus`)
  stays keyed to the typed form to match the streaming events. A cold-start
  race guard re-resolves from the (now-cached) canonicalize call if the fetch
  finishes before the recon canonicalize does.

## Files Modified

- `src/gapmap/research/collect.py` — fix the clobbered-variable alias bug
  (`register_alias(original_typed, search_topic)`).
- `app-tauri/src/screens/collect.js` — `storageTopic` / `adoptCanonical()`;
  `buildGraph`, `enrichGraph`, `exportHtml`, `monitorRunTopic`, and `openBtn`
  navigation now use the canonical key.

## Known follow-up (not done here)

Topics already fragmented by this bug before the fix (e.g.
`indian student exam stress` vs `Indian student exam stress`,
`speaking communication skills app research` vs the full phrase) still hold
papers under the variant keys. They can be consolidated with the existing
**Merge topics** tool — left as an explicit user-driven action, not auto-merged.
