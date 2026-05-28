# Source-link builder: respect source on every screen (Reddit-prefix only for reddit/lemmy)

**Date:** 2026-05-28
**Type:** Fix

## Summary

Several screens were unconditionally prefixing `r.permalink` with
`https://reddit.com` regardless of the row's `source_type`. On the
`multi-source` branch this routinely produced 404s — an HN, GNews, App
Store or arXiv row whose `posts.url` was the canonical link, but which
also happened to carry a permalink-shaped value, was being rendered as
`https://reddit.com<bogus-path>`. Even where `r.url` was preferred,
the fallback branch still hard-coded `reddit.com` and broke for
non-Reddit sources that had a permalink but no url.

`posts.js` already had a source-aware `postLink()` helper, but it was
local and never reused — every other screen reimplemented the broken
inline pattern. Extracted the helper into `src/lib/postLink.js`, added
a unit-test suite that locks in the multi-source contract, and routed
every screen that renders a finding's external link through it.

The Reddit-only screens (`search.js`, `watch.js`) are unchanged: their
result rows are guaranteed-Reddit by construction, so the inline
`https://www.reddit.com${permalink}` is correct there.

## Root cause

`postLink(row)` must dispatch on the row's `source` (or `source_type`)
before deciding to Reddit-prefix the permalink. The old per-screen code
defaulted to the Reddit prefix for any row that had a `permalink`
field, regardless of source. Inline patterns it replaced:

```js
// insights.js:655 — counter-evidence modal
r.permalink ? 'https://reddit.com' + r.permalink : (r.url || '#')

// insights.js:1016 — research links modal
r.url || (r.permalink ? 'https://reddit.com' + r.permalink : '#')

// topic.js:3119 — research tab "Open source" button
r.url || r.permalink || ''   // returns bare relative path → in-app 404

// topic.js:4223 — searchAll posts bucket
p.url || (p.permalink ? 'https://reddit.com' + p.permalink : '#')

// audience.js:146 — persona exemplar post
(ex?.url || ex?.permalink) || postLinkUrl(id)
// (ex.permalink alone is a relative reddit path → broken)
```

Each above is replaced by `postLink(row)` from the new shared module.

## Changes

- **Added** `src/lib/postLink.js` — single source of truth: takes a row
  with `{ source | source_type, url, permalink }` and returns
  `https://www.reddit.com<permalink>` only for `REDDIT_FAMILY`
  (`reddit`, `lemmy`); otherwise prefers `posts.url`; falls back to
  `''` (callers `||` with `'#'` or other fallback). Never returns a
  bare relative permalink that the in-app browser would treat as a
  same-origin click.
- **Added** `src/lib/postLink.test.mjs` (8 cases): reddit + lemmy
  permalink, hn/appstore/arxiv `url`-preferred, raw posts-table shape
  (`source_type`), default-to-reddit on missing source, empty/null
  inputs return `''`, and the specific regression — a non-reddit row
  with a stray permalink never produces `https://reddit.com/...`.
- **Modified** `src/screens/posts.js` — replaced the local
  `postLink()` + `REDDIT_FAMILY` const with imports from
  `src/lib/postLink.js`; `renderRow()` now does
  `const link = postLink(p) || '#';`.
- **Modified** `src/screens/insights.js` — counter-evidence modal and
  research-links modal both route through `postLink(r)`.
- **Modified** `src/screens/topic.js` — research tab "Open source"
  button and searchAll posts bucket both route through `postLink()`.
- **Modified** `src/screens/audience.js` — persona exemplar post block
  now uses `postLink(ex) || postLinkUrl(id)` so a stray non-reddit
  permalink never becomes a relative link.
- **Modified** `package.json` — added `src/lib/postLink.test.mjs` to
  the `npm test` runner. All 37 tests pass.

## Files Created

- `app-tauri/src/lib/postLink.js`
- `app-tauri/src/lib/postLink.test.mjs`

## Files Modified

- `app-tauri/src/screens/posts.js` — import shared helper, drop local copy
- `app-tauri/src/screens/insights.js` — counter-evidence (line 656) + research-links (line 1017)
- `app-tauri/src/screens/topic.js` — research tab open button (line 3120) + searchAll posts bucket (line 4224)
- `app-tauri/src/screens/audience.js` — persona exemplar post (line 151)
- `app-tauri/package.json` — `npm test` now includes postLink suite

## Verification

- `npm test` → 37 tests pass.
- `grep -rn "reddit.com.*permalink" src/screens/ src/lib/` only matches
  the `search.js` and `watch.js` Reddit-only paths and the
  `postLink.js` helper itself. No screen still inlines the broken
  pattern.
- Per-source spot-check against `REDDIT_FAMILY`:
  reddit ✓ / lemmy ✓ → `reddit.com<permalink>`;
  hn / appstore / playstore / arxiv / openalex / pubmed / scholar /
  gnews / devto / stackoverflow / github / github_issue / mastodon /
  bluesky / youtube / discourse / local_file / rss → `posts.url` only.

## Notes

- `shell:allow-open` is granted in `src-tauri/capabilities/default.json`,
  so `<a target="_blank">` clicks do open the user's default browser —
  this change is purely about the URL string, not the click delegation.
- The `data-open` + `api.openUrl()` pattern in `topic.js`'s research
  tab is preserved; only the URL it forwards is fixed.
- Existing `dist/` bundle still carries the old strings; will be
  replaced on next `npm run build`. Source is the source of truth.
