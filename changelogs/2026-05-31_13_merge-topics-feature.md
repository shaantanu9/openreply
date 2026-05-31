# Merge Topics — user-driven two-topic merge

**Date:** 2026-05-31
**Type:** Feature

## Summary

Added a GUI feature to merge two arbitrary topics the user knows are the
same into one. Previously only system-created duplicates (LLM
canonicalization) could be merged via `merge_duplicate_topics`; there was
no way to combine two user topics. The new feature re-points **all**
topic-keyed data (posts, graph nodes/edges, chats, papers, personas,
insights, briefs, products, experiments, …) from a source topic into a
target, removes the source, and optionally re-runs enrichment on the
merged corpus. Reachable from both each topic's context-menu ("Merge
into…") and a Settings → Trash & data → "Merge topics…" card.

Built in an isolated git worktree (`feat/merge-topics-wt`) because a
concurrent session was editing the shared checkout — avoids entangling
the two efforts' uncommitted work.

## Changes

- Python `merge_topics(source, target, apply=False)` in `topic_resolver.py`
  — schema-derived full re-point in a single transaction, dry-run preview,
  alias + canonicalization re-routing, via a uniform `_repoint_topic()`
  over every table with a `topic` column (composite-PK dedupe, single-row
  reports, plain columns all handled in one pass).
- New `topic-merge` Typer CLI command (`--source/-s --target/-t --apply`).
- New Rust `merge_topics` Tauri command + handler registration.
- New `api.mergeTopics(source, target, apply)` binding (dry-run preview vs
  applying + cache invalidation).
- New `mergeModal.js` with live dry-run preview, swap, auto-re-enrich
  toggle; wired into the topic context-menu and a Settings card (via a
  global `[data-open-merge]` click-delegation).
- Tests covering re-point, composite-PK dedupe, dry-run vs apply, and
  input validation (5 new tests, all passing).

## Files Created

- `app-tauri/src/screens/mergeModal.js`
- `tests/test_topic_merge.py`
- `docs/superpowers/specs/2026-05-31-merge-topics-design.md`

## Files Modified

- `src/gapmap/research/topic_resolver.py` — `merge_topics` + helpers
- `src/gapmap/cli/main.py` — `topic-merge` command
- `app-tauri/src-tauri/src/commands.rs` — `merge_topics` command
- `app-tauri/src-tauri/src/main.rs` — register `merge_topics`
- `app-tauri/src/api.js` — `mergeTopics` binding
- `app-tauri/src/screens/home.js` — context-menu "Merge into…" + import
- `app-tauri/src/screens/settings.js` — "Merge topics…" card + side-effect import

## Verification

- `pytest tests/test_topic_merge.py` → 5 passed
- `cargo check` → exit 0, 0 errors
- `node --check` on mergeModal.js / home.js / settings.js / api.js → all OK
- CLI: `topic-merge` registered (84 research commands); dry-run against the
  live DB returned correct preview (e.g. `public speaking` →
  `public_speaking`: 135 posts to move, 87 duplicates skipped, 455 nodes).
