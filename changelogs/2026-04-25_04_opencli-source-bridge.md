# opencli Source Bridge — Phase 1

**Date:** 2026-04-25
**Type:** Feature

## Summary

Adds a thin Python subprocess bridge to `@jackwener/opencli`, a Node CLI
with 100+ site adapters, and wires three PUBLIC-strategy adapters
(`oc_bluesky`, `oc_substack`, `oc_producthunt_today`) into the existing
`SOURCES` registry. Rows land in the same `posts` table and auto-index
into the mempalace, so existing search/insights/graph flows pick them
up with no further changes.

## Why these three first

- `oc_substack` — Substack post search has no native equivalent.
- `oc_producthunt_today` — Daily PH leaderboard, complements the
  existing `producthunt` search adapter (different command).
- `oc_bluesky` — Author-handle search (vs. native `bluesky` which
  searches POSTS); useful for authority-mapping per topic.

Browser-required adapters (twitter, youtube, google-scholar, …) are
deferred to phase 2 once the Chrome-extension flow is in place.

## opencli resolution order

`opencli_bridge._resolve_entry()` checks in order:

1. `$OPENCLI_ENTRY` — explicit path to `dist/src/main.js`
2. `$OPENCLI_REPO/dist/src/main.js`
3. Sibling repo at `../../opencli/dist/src/main.js`
4. Global `opencli` on PATH

If none resolve, `is_available()` returns False and adapters return 0
rows — never crashes the wider collect run.

## Smoke-test results (live)

```
oc_bluesky            5 rows for "tauri"
oc_substack           3 rows for "tauri"
oc_producthunt_today  5 rows (daily leaderboard, ignores topic)
```

## Changes

- New: `src/reddit_research/sources/opencli_bridge.py` —
  `is_available()`, `run(site, command, args)`. Spawns
  `node <opencli> <site> <command> <args> --format json`, parses stdout,
  graceful `[]` on any failure (timeout, non-zero exit, JSON parse).
- Edited: `src/reddit_research/sources/collect_adapter.py` —
  added `_oc_persist`, `run_oc_bluesky`, `run_oc_substack`,
  `run_oc_producthunt_today`, registered all three in `SOURCES`.

## Files Created

- `src/reddit_research/sources/opencli_bridge.py`
- `changelogs/2026-04-25_04_opencli-source-bridge.md`

## Files Modified

- `src/reddit_research/sources/collect_adapter.py` — three new adapters,
  one shared `_oc_persist` helper, three new `SOURCES` entries.

## Setup notes (one-time)

```bash
# Sibling-repo layout (zero-config):
cd ../opencli && npm install && npm run build
# OR explicit env override anywhere:
export OPENCLI_REPO=/path/to/opencli
```

Adapters silently skip if opencli is not built/resolved, so the rest of
`research_collect()` keeps working.

## Phase 2 (not in this changelog)

- Wrap browser-required adapters (twitter, youtube, google-scholar,
  amazon, linkedin) once Chrome extension + daemon flow is shipped.
- UI source picker reads `SOURCES.keys()` so the three new ids appear
  automatically once the user picks them.
- Optional: bundle Node + opencli into the Tauri sidecar for users who
  don't have Node installed (deferred — current dev-machine flow works).
