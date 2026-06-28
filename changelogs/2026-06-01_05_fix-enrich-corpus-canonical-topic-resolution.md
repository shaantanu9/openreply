# Fix LLM extraction stuck at "Starting LLM extraction…" — corpus read now resolves canonicalized topics

**Date:** 2026-06-01
**Type:** Fix

## Summary

The Map tab's auto-enrichment ("Starting LLM extraction…") could hang forever
for a topic whose name had drifted from the canonical name its corpus was
stored under. Root cause: `corpus_for()` does an exact `WHERE topic = ?` match,
but `collect` resolves topics on WRITE (`resolve_topic`), so a product/topic
like **"Indian samaj community help app"** has its corpus + findings stored
under the canonical **"Indian community help app"**. The enrich corpus lookup
returned zero rows → `enrich` returned `{"ok": false, "error": "No corpus found
for topic=… Run collect first"}` → the streaming banner sat on "Starting LLM
extraction…".

Asymmetry confirmed: `collect.py` calls `resolve_topic` (writes land on
canonical) but the enrich read path (`gaps.py` → `corpus_for`) did not resolve
at all.

## Changes

- **`topic_resolver.py`** — added `canonical_for_read(topic)`, a READ-ONLY
  resolver that consults `topic_aliases` AND the legacy
  `topic_canonicalizations.original` table (case-insensitive). It intentionally
  does NOT write/register and is separate from `resolve_topic` (whose
  2026-04-21 contract forbids silently redirecting user WRITE input).
- **`collect.py` `corpus_for`** — when the literal topic returns zero rows,
  resolve via `canonical_for_read` and retry the query ONCE. Guarded on empty,
  so a topic that has its own corpus is never hijacked by a canonicalization
  mapping. Every corpus consumer (enrich, map export, synthesis) benefits.

## Verification (dev venv, real data dir)

- `corpus_for('Indian samaj community help app')`: 0 → **20 rows** (resolves).
- `canonical_for_read('Indian samaj community help app')` → `'Indian community help app'`.
- Guard: `corpus_for('home decor')` (own corpus) → 20 rows, unchanged.
- End-to-end enrich now **runs to completion** instead of erroring: emits
  `enrich:start` (corpus_size 120, provider nvidia) → `extractor:done`
  (5 painpoints) → `enrich:done {ok: true}`. (Previously: immediate
  `No corpus found`.)

## Known follow-up (NOT in this change — needs user decision)

Even with the corpus read resolved, **findings are stored/displayed under the
canonical topic** while the product record still points to the drifted name
("Indian samaj community help app" = 1 finding vs "Indian community help app" =
1,405). So the product's Map/findings view won't surface the existing 1,405
findings until the names are aligned (register alias + repoint product to
canonical, or update the product's topic). That modifies user data, so it's
deferred to an explicit decision rather than done silently.

## Files Modified

- `src/openreply/research/topic_resolver.py` — new `canonical_for_read()` helper.
- `src/openreply/research/collect.py` — `corpus_for()` empty-result canonical retry.
