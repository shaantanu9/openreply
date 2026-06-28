# FSD Fleet — Debate Token-Cost Governance (Phase 3b)

**Date:** 2026-06-14
**Type:** Feature

## Summary

Phase 3b of the FSD Fleet roadmap: per-debate **token-cost accounting + budget
governance**. The debate now estimates the tokens it spends and records them on
the run; the replay/audit header shows the cost, and an optional per-debate
token budget (`OPENREPLY_DEBATE_TOKEN_BUDGET`) drives a colored alert chip
(ok → warning → critical → exceeded), with an "over budget" note in the
debate-complete toast.

Real provider usage is available in the raw OpenAI/Anthropic responses but is
discarded by the shared `complete()` interface; surfacing it would mean changing
the provider abstraction every other feature depends on. This ships a
self-contained **character-based estimate** (~4 chars/token over prompt + system
+ response) instead — honest, labeled "(est)", and good enough for budget
governance. Swapping to real usage later is a localized change in `deliberate.py`.

## Changes

- **deliberate.py:** `_persona_vote` accepts a `cost_acc` accumulator and adds an
  estimated token count per LLM call; `deliberate()` threads it and returns
  `cost_tokens_est`.
- **debate_run.py:** `run_topic_debate` persists `cost_tokens` on the run and
  returns `cost_tokens` + `budget`; new `_budget_status()` reads
  `OPENREPLY_DEBATE_TOKEN_BUDGET` and returns an alert level; `get_debate_audit`
  attaches the budget status.
- **UI (`debatePanel.js`):** replay header shows `~N tok (est)` + a budget chip;
  debate-complete toast includes cost and an over-budget warning. Budget chip
  styles in `style.css`.

## Verification

- `tests/test_debate_run.py` 7/7 — incl. `_budget_status` level thresholds and a
  fake-provider test that runs the real LLM persona path (also re-confirms the
  `persona_conclusions` fix), asserting `cost_tokens > 0`, a recorded transcript,
  and that a tiny budget trips `exceeded`.
- `npm run build` clean · `npm test` 52/52.

## Phase 3 remainder (still designed, not built)

Streaming agent reasoning, and the clarify→fleet→synthesize orchestration.
Cost is an estimate, not real provider usage (documented above).

## Files Modified

- `src/openreply/research/deliberate.py` — token estimate accumulator.
- `src/openreply/research/debate_run.py` — cost persistence + `_budget_status` + audit budget.
- `app-tauri/src/screens/debatePanel.js` — cost + budget chip in replay header & toast.
- `app-tauri/src/style.css` — budget chip styles.
- `tests/test_debate_run.py` — budget + fake-provider cost tests.
