# Topic resolver (duplicate prevention) + type-to-confirm delete

**Date:** 2026-04-21
**Type:** Feature + Fix — quality + safety

## Summary

Two related fixes around topic lifecycle:

### 1. Topic resolver — prevents "3 rows for one search"

Before: typing `"Indian student exam stress"` could land three rows on the
Dashboard — the user-typed form, the LLM-lowercased canonical, and a
slug-only variant from some downstream codepath. Each row split the corpus,
graph, and findings.

After: explicit, user-respecting contract:

- `resolve_topic(user_input, register=False)` — read-only. Consults
  `topic_aliases` table only. Does NOT auto-lowercase, slugify, or
  silently redirect user input. Returns user_input unchanged unless a
  prior LLM canonicalization bound it to a canonical form.
- `find_existing_topic(user_input)` — read-only pre-check. Returns the
  best-matching existing topic with its post count if a semantic duplicate
  already exists. Used by the New Topic modal to prompt the user with
  three choices: open existing, create separate topic, or cancel.
- `register_alias(alias, canonical, source="llm")` — only called from two
  places:
  1. The LLM canonicalize path in `collect.py` when the LLM rewrote the
     user's input (e.g. `calari tracking` → `calorie tracking`)
  2. `merge_duplicate_topics(apply=True)` when the user explicitly merges
- `merge_duplicate_topics()` — retroactive cleanup scoped to LLM-caused
  duplicates ONLY. Bucketed via `topic_canonicalizations` table + alias
  source. Pure case/slug variants without an LLM binding are left alone
  because we can't tell if the user meant them as different topics.

Collect-time changes: the `topic_prefs` insert was moved to **after**
`_canonicalize_topic` resolves. Previously we inserted the user-typed
form immediately (for instant `list_topics` visibility) then re-inserted
the canonical later — a race between `_tag_posts` and the LLM window left
two rows. Now only one row is written, for the final canonical form.

UI pre-check: the New Topic modal in `main.js` now calls
`api.findExistingTopic(topic)` before starting a collect. If a variant
already exists, user is asked:

> A topic "Indian student exam stress" with 139 posts already exists.
> OK = open the existing topic.
> Cancel = create a separate topic anyway.

No silent merges. User intent wins.

MCP callers that bypass `collect()` and go straight to `upsert_semantic`
also read the alias table (read-only) — so the graph side stays in sync
without auto-rewriting user input.

### 2. Type-to-confirm delete modal

Replaces the native browser `confirm()` dialog on both Delete Topic sites
(topic page header + topic settings card) with a reusable type-to-confirm
modal. User must type the exact topic name to unlock the Delete button.

- Escape / backdrop click / Cancel all abort.
- Enter submits when the typed string matches.
- Live feedback ("✓ matches — action unlocked" / "does not match yet").
- Auto-focus input; auto-restore focus on close.
- Lives in `lib/deleteConfirm.js` — reusable for Delete Product, Clear
  Data, Reset DB, or any other destructive action that warrants friction.

## Changes

### New files
- `src/reddit_research/research/topic_resolver.py` — `resolve_topic`,
  `find_existing_topic`, `register_alias`, `merge_duplicate_topics`.
  New `topic_aliases` table with lazy creation.
- `app-tauri/src/lib/deleteConfirm.js` — `confirmDestructiveAction({title,
  body, matchText, confirmLabel, confirmDanger, caseInsensitive, hint})`
  returning a Promise<boolean>.

### Modified files
- `src/reddit_research/research/collect.py` — deferred `topic_prefs` insert
  to after canonicalize resolves; register_alias on canonical rewrite;
  read-only resolver lookup in `_tag_posts`.
- `src/reddit_research/graph/semantic.py` — read-only resolver lookup at
  top of `upsert_semantic` so MCP callers land on the right canonical.
- `src/reddit_research/cli/main.py` — `research find-existing-topic` and
  `research merge-duplicate-topics` subcommands.
- `app-tauri/src-tauri/src/commands.rs` — `find_existing_topic` and
  `merge_duplicate_topics` Tauri commands.
- `app-tauri/src-tauri/src/main.rs` — registered both new handlers.
- `app-tauri/src/api.js` — `findExistingTopic(userInput)` and
  `mergeDuplicateTopics(apply)` JS bindings.
- `app-tauri/src/main.js` — New Topic modal `#modal-start` handler now
  pre-checks `findExistingTopic` and prompts the user.
- `app-tauri/src/screens/topic.js` — both Delete Topic sites now use the
  type-to-confirm modal instead of `confirm()`.

## How to use

### Fix the existing 3-row mess

```bash
# Dry-run — inspect the merges array
reddit-cli research merge-duplicate-topics

# If the winner/losers look right:
reddit-cli research merge-duplicate-topics --apply
```

Only LLM-caused duplicates are merged. User-created case variants stay
separate until the user explicitly cleans them up.

### Re-running the same search

Type the same topic again → modal detects the existing corpus and asks
whether to open the existing topic or create a separate one. No silent
merges, no lost data.

### Delete a topic

Open the topic page → click Delete → modal shows. Type the exact topic
name in the input → Delete button unlocks. Escape / backdrop cancels.

## Files Created

- `src/reddit_research/research/topic_resolver.py`
- `app-tauri/src/lib/deleteConfirm.js`
- `changelogs/2026-04-21_06_topic-resolver-and-delete-confirm.md`

## Files Modified

- `src/reddit_research/research/collect.py`
- `src/reddit_research/graph/semantic.py`
- `src/reddit_research/cli/main.py`
- `app-tauri/src-tauri/src/commands.rs`
- `app-tauri/src-tauri/src/main.rs`
- `app-tauri/src/api.js`
- `app-tauri/src/main.js`
- `app-tauri/src/screens/topic.js`
