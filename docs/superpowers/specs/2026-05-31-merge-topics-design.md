# Merge Topics — Design Spec

**Date:** 2026-05-31
**Status:** Implemented (worktree: feat/merge-topics-wt)
**Author:** Claude (brainstormed + approved by user)

## Problem

The app keys every piece of data by a `topic` **string** spread across ~30
tables. Users accumulate near-duplicate topics they know are the same
(e.g. `public speaking` vs `public_speaking`, `Laptop memeory cache clean`
vs `Laptop memory cache clean`). The existing `merge_duplicate_topics`
only collapses **system-created** dupes (LLM canonicalization, traced via
`topic_canonicalizations`). There was **no way** for a user to merge two
topics they personally decided are the same.

## Decisions (user-approved)

1. **Entry points:** both a topic-card context-menu action *and* a Settings panel.
2. **Data scope:** everything — full re-point of all topic-keyed tables.
3. **Report conflict:** auto re-run enrichment on the merged corpus
   (graceful skip if no LLM key).
4. **Cardinality:** one source → one target only (no batch).

## Architecture

Follows the existing delete/restore command triangle.

```
Topic card menu ─┐
                 ├─▶ mergeModal.js ─▶ api.mergeTopics(source,target,apply)
Settings card  ──┘        │              │ invoke('merge_topics', …)
                          ▼              ▼
                   dry-run preview   commands.rs::merge_topics
                                      └▶ run_cli(["research","topic-merge",…])
                                           └▶ topic_resolver.merge_topics()
                                                └▶ _repoint_topic() over all
                                                   topic-keyed tables (one txn)
```

## Components

### Python — `src/openreply/research/topic_resolver.py`
- `merge_topics(source, target, apply=False)` — validates input
  (no empties, no self-merge, source must exist), computes a dry-run
  preview (`posts_to_move`, `duplicate_posts_skipped`, `nodes_to_move`,
  `chats_to_move`, `tables_touched`), and on `apply=True` performs the
  re-point inside a single `with db.conn:` transaction, then registers a
  `topic_aliases` entry (source→target) and re-points
  `topic_canonicalizations.canonical`.
- `_repoint_topic(db, source, target)` — schema-derived: iterates every
  table with a `topic` column and runs `UPDATE OR IGNORE … ; DELETE …`.
  One uniform pair handles all three table classes: composite-PK incl.
  topic (dedupe), single-row-per-topic reports (target wins), plain
  topic column (all moved).
- `_topic_keyed_tables`, `_post_count`, `_known_topics` helpers.

### Python CLI — `src/openreply/cli/main.py`
- `@research_app.command("topic-merge")` with `--source/-s`, `--target/-t`,
  `--apply`, `--json`.

### Rust — `app-tauri/src-tauri/src/`
- `commands.rs::merge_topics(app, source, target, apply)` — thin
  `run_cli(["research","topic-merge", …])` wrapper.
- `main.rs` — registered in `generate_handler!`.

### JS — `app-tauri/src/api.js`
- `api.mergeTopics(source, target, apply=false)` — dry-run returns preview
  without mutation; apply fires `mutated('topics')` to invalidate caches.

### UI — `app-tauri/src/screens/mergeModal.js`
- Self-contained modal (`.modal-backdrop` / `.modal-card` vocabulary):
  target dropdown (+ source dropdown in Settings path), swap, live
  dry-run preview, re-enrich checkbox, danger-styled confirm.
- Entry points: `home.js` topic context-menu ("Merge into…", preset
  source) and `settings.js` Trash & data section ("Merge topics…" card).
- Settings button uses a global `[data-open-merge]` click-delegation
  registered as a module side-effect, so it needs HTML only.
- On success: toast → optional `api.enrichGraph(target)` → navigate to target.

## Safety

- Single SQLite transaction (all-or-nothing).
- Refuses self-merge / empty / missing source.
- Re-point moves rows (posts shared by `post_id` move implicitly via
  `topic_posts`).
- Confirm modal spells out exactly what moves before applying.
- Built in an isolated git worktree to avoid colliding with a concurrent
  session editing the shared checkout.

## Tests — `tests/test_topic_merge.py`
- dry-run non-mutating; preview counts correct (incl. dup skip).
- apply re-points + dedupes; source drained, target = union.
- self-merge / missing source / empty args rejected.

## Out of scope (YAGNI)
Multi-topic batch merge, undo/history, fuzzy "suggest similar" merge.
