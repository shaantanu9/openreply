# Fix: blank titles for title-less sources (Mastodon toots, reviews)

**Date:** 2026-07-01
**Type:** Fix

## Summary

Opportunities discovered from sources that have no native title — Mastodon
toots, Play Store / Steam reviews — rendered with a **blank title** in the
"Finding conversations" scan and the Opportunities list (reported for
`mastodon:mastodon.social`). Those sources store their text in `selftext` with
`title = ""`, and the opportunity card showed the empty title verbatim.

## Changes

- `src/openreply/reply/opportunity.py`: added `_display_title(post)` — when a
  post has no title, fall back to a whitespace-collapsed first ~80 chars of the
  body (or `"(untitled post)"` if truly empty). Used in `_build`, so **every**
  title-less source gets a usable opportunity title, including posts already in
  the corpus (applied on the next scan/upsert).
- `src/openreply/sources/mastodon.py`: `_row` now derives the stored `title`
  from the toot content (short snippet) instead of `""`, so the `posts` table
  itself carries a usable title for the digest / library / graph too.

## Verification

- Unit-tested `_display_title`: empty-title → body snippet; real title → passthrough;
  empty body → `"(untitled post)"`.
- Unit-tested mastodon `_row`: a sample toot now yields
  `title="Looking for a good self-hosted note app…"`, `sub="mastodon:mastodon.social"`.

## Files Modified

- `src/openreply/reply/opportunity.py`
- `src/openreply/sources/mastodon.py`
