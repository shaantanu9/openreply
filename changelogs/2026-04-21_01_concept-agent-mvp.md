# Concept Agent — bare-minimum monetization MVP

**Date:** 2026-04-21
**Type:** Feature

## Summary

First slice of the 8-agent product-vision layer (per `docs/superpowers/specs/2026-04-20-product-vision-agents.md`): the Concept Agent generates 3-5 evidence-backed product ideas from a topic's painpoints, sentiment, and workarounds in one LLM call. Each concept is persisted as a graph node with `has_concept` and `based_on` edges so the UI can render clickable citations back to the source painpoints. No paywall, no export, no Stripe — ship the feature, post it free, measure if anyone cares before building billing (per `docs/superpowers/specs/2026-04-20-monetization-strategy.md`).

## Changes

- New `research concepts --topic X [--json]` CLI subcommand
- New `run_concepts(topic)` Tauri command + `api.runConcepts(topic)` JS bridge
- New Concepts tab on the topic screen (in the More dropdown, lightbulb icon)
- Empty state pitches the agent, re-run button lives in the toolbar
- Concepts cached in `graph_nodes kind='concept'` — re-opening the tab renders existing rows instantly without another LLM call
- Re-uses the Solutions tab card styling (`.solutions-card`) — no new design system, only minor CSS additions
- `tests/test_integration.py` is not touched — existing tests keep passing

## Files Created

- `docs/superpowers/specs/2026-04-20-monetization-strategy.md` — pricing, audience, distribution, pre-launch validation loop (previously created in session, listed for completeness)
- `prompts/concept.yaml` — Concept extractor prompt (system + user_template + JSON schema)
- `src/reddit_research/research/concept.py` — `concepts_for_topic(topic, provider, max_concepts)` implementation with graph persistence and evidence-edge wiring
- `app-tauri/src/screens/concepts.js` — Concepts tab renderer
- `changelogs/2026-04-21_01_concept-agent-mvp.md` — this entry

## Files Modified

- `src/reddit_research/cli/main.py` — added `@research_app.command("concepts")`
- `app-tauri/src-tauri/src/commands.rs` — added `run_concepts` Tauri command wrapping the CLI
- `app-tauri/src-tauri/src/main.rs` — registered `run_concepts` in `generate_handler!`
- `app-tauri/src/api.js` — added `runConcepts` bridge
- `app-tauri/src/screens/topic.js` — imported and wired the Concepts tab (More dropdown + loader)
- `app-tauri/src/style.css` — added `.concept-card` + `.chips-row` styling; tightened `.solutions-toolbar` layout for the Re-run button
