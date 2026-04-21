# AG-C — Global competitor dedup (T2.5) + finding feedback 👎 (T2.4)

**Date:** 2026-04-20
**Type:** Feature

## Summary

Two independent Tier-2 features landed together under the AG-C agent lane:

1. **T2.5 — Global competitors view.** New cross-topic page at `#/competitors` that clusters product-kind `graph_nodes` across every topic by MiniLM embedding cosine ≥ 0.80 and renders one card per unified competitor (canonical name, alias list, topic breakdown, mention totals). Built on top of the existing ChromaDB embedder used by `graph/relations.py` — no new LLM calls.

2. **T2.4 — Finding feedback 👎.** Each insight finding card now has a 👎 button that prompts for a verdict (wrong / off_topic / spam) + optional note. Feedback persists to the pre-existing `finding_feedback` table and is injected into the next `synthesize_insights` prompt as a `## Previously-flagged mistakes on this topic — DO NOT repeat` block so the LLM stops re-surfacing rejected findings.

## Changes

- Extended `competitors.py` with `global_competitors(min_topics, threshold)` — greedy single-link clustering over product labels, skipped-gracefully when chromadb unavailable.
- New `feedback.py` module with `record_feedback` + `feedback_for_prompt` (dedupes latest verdict per title, caps per-bucket for prompt size).
- Injected negative-examples block into `synthesize_insights` right after the user_prompt is built — best-effort, wrapped in try/except so feedback never blocks synthesis.
- New CLI commands: `research global-competitors` and `research feedback-record`.
- New Tauri commands: `global_competitors`, `feedback_record` — registered in `main.rs` invoke_handler.
- New api.js bindings: `api.globalCompetitors(...)` (cached 60s) and `api.feedbackRecord(...)` (invalidates insights cache).
- New screen `screens/global_competitors.js` — grid of expandable cards, refresh controls for min_topics + threshold.
- New route `#/competitors` → `renderGlobalCompetitors`.
- Nav link "Competitors" added to `index.html` sidebar (after Products).
- Insights finding cards now render a 👎 button in the head; `wireCards` collects click → prompt for verdict/note → `api.feedbackRecord` → disables button on success.

## Files Created

- `src/reddit_research/research/feedback.py`
- `app-tauri/src/screens/global_competitors.js`
- `changelogs/2026-04-20_99_ag-c-global-competitors-and-feedback.md`

## Files Modified

- `src/reddit_research/research/competitors.py` — added `global_competitors` and helpers.
- `src/reddit_research/research/insights.py` — injected feedback negative-examples block into the synthesize prompt.
- `src/reddit_research/cli/main.py` — two new research commands.
- `app-tauri/src-tauri/src/commands.rs` — `global_competitors`, `feedback_record` Tauri commands appended before the tests mod.
- `app-tauri/src-tauri/src/main.rs` — two new commands added to the invoke_handler list.
- `app-tauri/src/api.js` — `globalCompetitors`, `feedbackRecord` bindings.
- `app-tauri/src/main.js` — imported `renderGlobalCompetitors`, added `#/competitors` route.
- `app-tauri/index.html` — Competitors nav link under Workspace.
- `app-tauri/src/screens/insights.js` — 👎 button markup + wiring in `wireCards`.
