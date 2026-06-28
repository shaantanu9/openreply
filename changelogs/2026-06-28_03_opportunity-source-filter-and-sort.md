# Opportunities — fix source-filter "shows nothing" + default newest-first

**Date:** 2026-06-28
**Type:** Fix

## Summary

Two follow-ups to the source-count dropdown: selecting a source could show an empty
list (looked broken), and the list defaulted to score order. Both fixed.

## Changes

- **Default sort → newest-first.** The Opportunities list now defaults to **Most recent**
  (`recent` = `coalesce(created_utc, found_at) desc`) instead of `score`, and the sort
  dropdown reflects it. Verified: top rows are today's posts, ordered latest → oldest.
- **Source-aware empty state.** The source dropdown intentionally lists *all* sources with
  their post + opportunity counts — including discovery-only sources (YouTube, DuckDuckGo,
  Google News) that have posts but **no scored opportunities**. Selecting one used to show
  a blank list. Now it explains: *"YouTube has 273 posts collected but no scored
  opportunities yet — it's a discovery source; pick a source with opportunities, or click
  Find opportunities."* (Sources that do have opportunities — Reddit, HN, Stack Overflow,
  Dev.to — filter correctly, confirmed: reddit 39, hn 16 shown.)
- **Fixed wrong pagination total when filtering by source.** `count_opportunities` ignored
  the `platform` arg, so a filtered view reported the unfiltered total (e.g. 61 instead of
  16). It now honors `platform`; the CLI passes it through.

## Verification

- `opportunity.py` + `reply_cmds.py` parse; `reply list --platform <src>` shows the right
  rows (and now the right total); `--sort recent` orders by real post date (today first).
  `vite build` passes (334 KB). No Rust changed.

## Files Modified

- `src/openreply/reply/opportunity.py` (`count_opportunities` platform), `src/openreply/cli/reply_cmds.py`,
  `app-tauri/src/or/dynamic.js` (default sort, sort-dropdown selected state, source-aware empty msg).
