# Insight Engine Phase 1 — Claude-native synthesis + opportunity scoring

**Date:** 2026-04-20
**Type:** Feature

## Summary

Ships Phase 1 of the Insight Engine roadmap: one long-context Claude call
that produces a structured market report across the full multi-source
corpus, replacing 4 isolated extractors with a single synthesis pass.
Output includes opportunity-scored findings, competitor landscape, and a
greenfield quadrant. New "Insights" tab becomes the primary topic view.

## Changes

- One-shot synthesis prompt packs up to 2000 posts across 13 source types
  into a single Claude call (1M context window), producing JSON with:
  executive summary, ranked findings, competitors, opportunity quadrant,
  citations per finding.
- Opportunity score = `pain_weight × (1 - competitor_coverage) × academic_bonus`
  (0–10 scale, auto-clamped post-LLM). Backed by source_diversity and
  academic_backing pulled from the corpus.
- Insights reports persist to new `topic_insights` table (one row per
  topic, upserted on re-run). UI loads cached first for instant render.
- New Insights tab set as DEFAULT tab on topic page — replaces Map as the
  "here's what matters" landing view.
- Quadrant SVG renders findings as dots positioned by pain vs coverage,
  colored by opportunity score. Greenfield / Crowded / Niche / Mature
  bucket labels baked in.

## Files Created

- `docs/specs/2026-04-20-insight-engine.md` — full 7-phase roadmap spec
- `prompts/insights_synthesis.yaml` — synthesis prompt + JSON schema
- `src/reddit_research/research/insights.py` — `synthesize_insights`,
  `load_insights`, `_select_corpus`, `_normalize_scores`
- `app-tauri/src/screens/insights.js` — Insights tab loader, quadrant,
  finding cards, competitor cards

## Files Modified

- `src/reddit_research/cli/main.py` — added `research insights --topic T
  [--cached] [--json]` command
- `app-tauri/src-tauri/src/commands.rs` — new `synthesize_insights`
  Tauri command
- `app-tauri/src-tauri/src/main.rs` — registered synthesize_insights in
  invoke_handler
- `app-tauri/src/api.js` — added `api.synthesizeInsights(topic, cached)`
- `app-tauri/src/screens/topic.js` — Insights tab added (default),
  loaders map updated, initial tab switched from 'map' to 'insights'
- `app-tauri/src/style.css` — ~140 lines of Insights tab CSS (quadrant,
  finding cards, competitor cards, chips)

## Next phases

- Phase 2: Build recommendations (per-finding MVP spec + differentiators)
- Phase 3: Competitor matrix (feature-vs-product table)
- Phase 4: Research-to-finding linking via the semantic palace
- Phase 5: Monitoring mode (weekly delta view)
- Phase 6: Export formats (pitch deck, battlecard, memo)
