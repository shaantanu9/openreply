# Phase 3 — Hypothesis Tracking / Decision Journal

**Date:** 2026-04-20
**Type:** Feature + docs
**Spec:** `docs/ROADMAP.md` §Phase 3

## Summary

Ships Phase 3 of the retention roadmap: turns every hypothesis card
produced by the Insight Engine into a stateful, trackable bet. Users
promote cards from Insights → new Bets tab → update state through the
lean-startup lifecycle (draft → running → validated/invalidated/paused →
archived) with per-transition journal notes.

This is the **single biggest retention lever** identified in
`docs/PRODUCT_GAPS.md`: it turns OpenReply from one-shot research into
a weekly practice where founders return to update their bets.

Also ships the **Dual-Mode Fork** annotation in `docs/ROADMAP.md` and
the validation playbook in `docs/VALIDATION_PLAN.md`. Both flow from
the review of `docs/DUAL_MODE_PIVOT.md` — Phases 3+4 are load-bearing
regardless of whether the bigger pivot succeeds, so they ship first.

## Changes

- New `hypothesis_tests` SQLite table: id, topic, card_json (frozen at
  save), status, started_at, resolved_at, resolution_notes (journal,
  append-only), linked_evidence, last_updated, created_at.
  Added to `init_schema` in `core/db.py`.
- 6 CLI commands: `research hypothesis-create|update|list|delete|stats`.
- 5 Tauri commands: `hypothesis_create`, `hypothesis_update_status`,
  `hypothesis_list`, `hypothesis_delete`, `hypothesis_stats`.
- `api.js`: `hypothesisCreate / UpdateStatus / List / Delete / Stats`
  with cache invalidation on mutations.
- New **Bets** tab on topic page (second tab, after Insights). Lists
  tracked bets grouped by state; each card shows full hypothesis prose,
  falsifiers, cheapest-test, journal notes, and next-state action
  buttons. Prompts for notes on validated/invalidated/paused transitions.
- **Save as bet** button on every hypothesis card in Insights tab.
  Freezes card + creates a draft bet in one click. Success toast with
  link to Bets tab.
- CSS: `.bet-*` state-colored cards, journal pre-wrap, toast
  animation, hypothesis-save-button row.

## Docs added / updated

- **`docs/ROADMAP.md`** — new top section "The Dual-Mode Fork" with
  ASCII flow diagram explaining when the Topic-Mode-only path diverges
  from the Dual-Mode pivot (after Phase 4 + validation experiment).
- **`docs/VALIDATION_PLAN.md`** — new. 14-day concierge-MVP playbook
  for 3 founders: selection criteria, manual Product-Mode dashboard
  template, observation signals (primary + negative), exit-interview
  script, decision matrix, budget, risks + mitigations, outreach
  templates.
- **`changelogs/2026-04-20_08_phase3-hypothesis-tracking.md`** — this
  file.

## Files Created

- `src/reddit_research/research/hypothesis_tracker.py`
- `app-tauri/src/screens/bets.js`
- `docs/VALIDATION_PLAN.md`
- `changelogs/2026-04-20_08_phase3-hypothesis-tracking.md`

## Files Modified

- `src/reddit_research/core/db.py` — `hypothesis_tests` table
- `src/reddit_research/cli/main.py` — 5 new `hypothesis-*` commands
- `app-tauri/src-tauri/src/commands.rs` — 5 new Tauri commands
- `app-tauri/src-tauri/src/main.rs` — registered new handlers
- `app-tauri/src/api.js` — 5 new `hypothesis*` bindings
- `app-tauri/src/screens/topic.js` — Bets tab added to tab bar + loader
- `app-tauri/src/screens/insights.js` — Save-as-bet button + wire
- `app-tauri/src/style.css` — Phase-3 CSS
- `docs/ROADMAP.md` — Dual-Mode Fork annotation
