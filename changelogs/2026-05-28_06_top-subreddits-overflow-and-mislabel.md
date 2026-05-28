# Top subreddits card: scope to reddit-family + CSS overflow hardening

**Date:** 2026-05-28
**Type:** Fix

## Summary

The "Top subreddits" card on the topic Sources tab was reading
`p.sub` from every source. On `multi-source` topics that put non-Reddit
buckets — GNews feed names, GitHub repo paths, arXiv venues, RSS feed
slugs, HN site domains — into a grid card whose tiles render
`r/<value>` in a monospace headline. Two visible failures:

1. **Wrong label.** Non-Reddit buckets shown as `r/<long-url>` mint
   fake subreddit links and confuse the user.
2. **Width overflow.** Long bucket strings (URLs, multi-segment repo
   paths) broke out of the `minmax(140px, 1fr)` tile track and pushed
   layout open horizontally.

Same class of bug surfaced on `#/find`: every hit's `meta.sub` was
rendered as `r/<sub>` regardless of `meta.source_type`.

## Root cause

The Sources-tab SQL grouped by `p.sub` with no source filter. The card
heading and tile renderer assume Reddit-shaped subs. The schema lets
every adapter reuse `p.sub` as a free-form bucket, so unfiltered
`GROUP BY p.sub` leaks every adapter's bucket strings into a
reddit-only UI element.

The `.sub-tile` CSS had no overflow protection (no `min-width:0`, no
`text-overflow:ellipsis`), so the grid track grew to fit the longest
string rather than ellipsing it.

## Changes

- **Modified** `src/screens/topic.js` — added
  `AND coalesce(p.source_type,'reddit') IN ('reddit','lemmy')` to the
  `subsSql` query (line 2903). "Top subreddits" now shows only real
  subs; non-Reddit buckets are surfaced via the per-source row above.
- **Modified** `src/style.css` — `.sub-tile` gets `min-width: 0;
  overflow: hidden;`; `.sub-tile h5` gets
  `overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  min-width:0;`; `.sub-tile span` gets the same single-line ellipsis
  treatment. Defensive against any future long sub.
- **Modified** `src/screens/find.js` — `r/<sub>` only when
  `REDDIT_FAMILY.has(meta.source_type)`. For everything else the
  bucket renders as a plain pill. Imports `REDDIT_FAMILY` from the
  shared `src/lib/postLink.js`.

## Verification

- `npm test` → 37 tests pass.
- Syntax check on `find.js`, `topic.js` → OK.
- For a topic with HN + arXiv + Reddit posts: the "Top subreddits"
  card now lists only Reddit subs; HN sites and arXiv venues no
  longer leak in. The per-source row card above still shows the full
  source breakdown.

## Files Modified

- `app-tauri/src/screens/topic.js` — `subsSql` scoped to reddit-family
- `app-tauri/src/style.css` — `.sub-tile{,h5,span}` overflow hardening
- `app-tauri/src/screens/find.js` — source-aware `r/<sub>` label
