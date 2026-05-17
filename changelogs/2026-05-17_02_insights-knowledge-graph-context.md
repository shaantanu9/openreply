# Insights synthesis — inject knowledge-graph context

**Date:** 2026-05-17
**Type:** Feature

## Summary

`synthesize_insights` now feeds the top-ranked knowledge-graph nodes for a
topic into the LLM prompt before findings are synthesised, so the model sees
the structural topology (pain-points, interventions, competitors already
identified) and cross-checks against it instead of duplicating known nodes.

## Changes

- In `research/insights.py`, before the LLM call, query `graph_nodes` for the
  topic's top-20 nodes by edge degree and append them to the user prompt as a
  "Knowledge Graph — top nodes already identified" section.
- Best-effort: silently skips when the graph is empty or `graph_nodes` does
  not exist yet, so topics without a built graph are unaffected.

## Files Modified

- `src/reddit_research/research/insights.py` — knowledge-graph context block
  appended to the synthesis prompt
