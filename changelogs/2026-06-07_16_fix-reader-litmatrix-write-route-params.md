# Fix: Reader / Lit-matrix / Write screens got the wrong route param (broken on click)

**Date:** 2026-06-07
**Type:** Fix (P0)

## Summary

Clicking a paper in the Library (or Papers list, or Lit-matrix) opened a broken
Reader; likewise `#/lit-matrix/<topic>` and `#/write/<topic>` loaded empty. Root
cause: the hash router dispatches as `render(main, { params: m.slice(1) })`, but
`renderReader`/`renderLitMatrix`/`renderWrite` declared the param positionally
(`renderReader(main, postId)`) and did `decodeURIComponent(postId)`. The second
arg is the wrapper object `{params:[...]}`, so `decodeURIComponent({...})`
produced `"[object Object]"` → a bogus post_id/topic → "Paper not found" / empty.

## Fix

Match the proven router contract used by `renderPaperMap`:
`render(main, { params } = {})` + `decodeURIComponent((params && params[0]) || '')`.
Applied to `reader.js`, `lit_matrix.js`, `write.js`.

## Verification

Reproduced the contract in node: old path → `"[object Object]"`; fixed path →
the correct id (verified including a slash-containing DOI like
`crossref_10.12693/aphyspola.119.986`, since encodeURIComponent + `[^/?]+` +
decodeURIComponent round-trips correctly). `node --check` clean on all three.

## Files Modified
- `app-tauri/src/screens/reader.js`, `app-tauri/src/screens/lit_matrix.js`,
  `app-tauri/src/screens/write.js`
