# Surface expanded keywords on the Collect screen + bump default fan-out

**Date:** 2026-04-24
**Type:** UI Enhancement

## Summary

User asked "when I fetch a topic, do we fetch all synonyms?" The short
answer is **yes** — canonicalization + LLM-scored keyword expansion is
already wired end-to-end via the `desktop-research-app-patterns` skill
(extracted from this repo). `_canonicalize_topic` runs once at pipeline
entry and `search_keywords` drives per-source fan-out. The issue was
visibility and a too-tight default cap.

## Changes

- **`GAPMAP_MAX_KEYWORDS` default bumped 4 → 6.** For a topic like
  "public speaking anxiety app," 6 gives enough room for canonical +
  "confident speaking" + "speaking tricks" + "convey message" + couple
  more. Each extra keyword adds ~1 s politeness sleep per source which
  is negligible vs total wall-time. Still env-tunable.
- **New CLI subcommand: `research canonicalize --topic T --json`.**
  Returns `{original, canonical, variants, confidence, search_keywords}`.
  Cheap when cached (one DB read). Drives UI surfaces and makes the
  expansion inspectable from a terminal.
- **New Tauri command: `canonicalize_topic(topic)`** + JS
  `api.canonicalizeTopic(topic)` wrapping the CLI. Registered in
  `main.rs::generate_handler`.
- **"Searching for…" strip on the Collect screen.** Paints the
  canonical topic as an orange pill + every filtered expansion as a
  neutral chip, with tooltips showing relevance tier. Appears above the
  per-source status grid so users see *what's being searched* before
  seeing *who's searching it*. Kicks off in parallel with `startCollect`
  so it never blocks the pipeline.
- **Correction + low-confidence hint.** When the canonical differs from
  the original (typo correction) or confidence is `low` with variants,
  a muted italic line under the chips surfaces it inline. Complements
  the existing `topicConfirm` modal on the Welcome flow.

## Files Created

- `changelogs/2026-04-24_08_surface-expanded-keywords-collect-screen.md`

## Files Modified

- `src/reddit_research/research/collect.py` — `GAPMAP_MAX_KEYWORDS`
  default 4 → 6 with updated comment.
- `src/reddit_research/cli/main.py` — new `research canonicalize`
  subcommand.
- `app-tauri/src-tauri/src/commands.rs` — new `canonicalize_topic`
  Tauri command.
- `app-tauri/src-tauri/src/main.rs` — registers the command.
- `app-tauri/src/api.js` — exposes `api.canonicalizeTopic`.
- `app-tauri/src/screens/collect.js` — adds the strip DOM, parallel
  fetch, and `renderSearchKeywordsStrip` helper.
- `app-tauri/src/style.css` — `.search-keywords-strip`, `.skw-chip`,
  `.skw-chip-canon|high|medium|low`, `.skw-hint` styling.

## Verification

1. Python: `ast.parse` on `cli/main.py` + `research/collect.py` → OK.
2. Rust: `cargo check` → clean.
3. Manual: `reddit-cli research canonicalize --topic "public speaking anxiety app" --json`
   returns `{canonical, variants, confidence, search_keywords: [...]}`.
4. Manual in the desktop app: start a new collect on a synonym-rich
   topic; the "Searching for…" strip appears within a second of the
   Collect screen loading, showing the canonical as the lead chip plus
   every relevance-floor-passing expansion. Typos show the correction
   hint; ambiguous topics show the low-confidence hint with variants.

## Relevance tiers mirror `collect.py`

- **Non-aggressive runs** — only `relevance === 'high'` chips are
  rendered (same floor the collect pipeline uses).
- **Aggressive runs** — `medium` included too (matches
  `_min_rel = 'medium' if aggressive else 'high'` in collect.py:406).
  `low` is never rendered — they're tangential and would clutter.
- The canonical is always the lead chip even if the LLM didn't echo
  it into `search_keywords` (defensive).

## Not in scope

- Letting users click a chip to toggle it off before collecting
  (so they can veto an unwanted expansion). The strip is currently
  read-only. Worth adding when users complain about specific
  spurious expansions.
- Applying the same strip to the **Topic** screen header so users
  returning to an existing topic can recall what was searched. The
  data is there (cached in `topic_canonicalizations`); this commit
  only wires the Collect flow.
- Re-running canonicalize when the user re-collects a topic after a
  while (cache is effectively permanent today). Stale expansions
  would get refreshed by wiping the `topic_canonicalizations` row.
