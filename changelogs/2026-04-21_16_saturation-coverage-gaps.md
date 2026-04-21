# Saturation v1 + Coverage Gaps Panel

**Date:** 2026-04-21
**Type:** Feature

## Summary

Task 8 of the incremental-enrichment plan. Adds two pure-SQL, zero-LLM
signals to every topic page: a saturation score (distinct graph clusters
per last 50 posts → rich / converging / saturated) and a coverage-gaps
strip that suggests one-click enrichments (+ Add appstore, + Add arxiv,
+ Deepen products…) whenever a data dimension drops below its threshold.
Both panels listen for `gapmap:changed` and refresh automatically after
every collect / enrich / ingest.

## Changes

- Python: `research.saturation.compute(topic)` — SQL window over last 50
  `topic_posts` joined to `graph_edges kind='evidenced_by'` (schema uses
  `src`/`dst` columns with `<topic>::post::<id>` dst format). Returns
  `{score, hint, new_clusters_last_50_posts, window_start}`.
- Python: `research.coverage.compute(topic)` — counts posts by
  `source_type`, buckets into 4 UX dimensions (reviews / academic / news
  / technical), flags anything under its threshold, plus a `competitors`
  gap when distinct product-kind nodes < 3.
- CLI: `reddit-cli research saturation --topic X --json` +
  `reddit-cli research coverage-gaps --topic X --json`.
- Tauri: `topic_saturation` + `topic_coverage_gaps` commands wired
  through `run_cli`, registered in `main.rs` generate_handler.
- Frontend: `api.topicSaturation` / `api.topicCoverageGaps` with 30s
  cache; added to the collect / graph / findings invalidate map so
  writes refresh them.
- `topic.js`: saturation chip in the compact header (tiny SVG sparkline
  + hint text); Coverage gaps panel below the tabs + above tab-content;
  both re-paint on `gapmap:changed`.
- CSS: `.topic-saturation` + `.coverage-gaps` styling.

## Files Created

- `src/reddit_research/research/saturation.py` (60 lines)
- `src/reddit_research/research/coverage.py` (84 lines)
- `changelogs/2026-04-21_16_saturation-coverage-gaps.md`

## Files Modified

- `src/reddit_research/cli/main.py` — two new Typer commands
  (`saturation`, `coverage-gaps`).
- `app-tauri/src-tauri/src/commands.rs` — `topic_saturation` +
  `topic_coverage_gaps` command bridges.
- `app-tauri/src-tauri/src/main.rs` — register both in
  `generate_handler!`.
- `app-tauri/src/api.js` — `topicSaturation` / `topicCoverageGaps`
  bindings + cache invalidation hooks.
- `app-tauri/src/screens/topic.js` — header badge, coverage-gaps panel
  insertion point, painters, `gapmap:changed` listener, "+ Add source"
  click handlers that fire `api.startCollect(topic, false, [src], false)`
  or `api.enrichGraph(topic)` for `deepen_products`.
- `app-tauri/src/style.css` — new `.topic-saturation` + `.coverage-gaps`
  classes.

## Schema Notes

Actual `graph_edges` schema uses `src`/`dst` columns (not
`source`/`target`) and the cluster-landing edge kind is `evidenced_by`
only (no `mentions_product`). Post-node IDs follow
`<topic>::post::<post_id>` format. SQL in `saturation.py` reconstructs
that format directly instead of substring LIKE joins. Coverage
suggested a `deepen_products` pseudo-source when product count < 3; the
UI maps that to `api.enrichGraph(topic)` rather than a collect.
