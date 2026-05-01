# Source picker: "Save (don't fetch yet)" + per-topic source memory

**Date:** 2026-04-30
**Type:** UI Enhancement

## Summary

The source-picker modal forced every "add a new source" action through an
immediate collect run. Picking sources → click Run → navigate to the
collect screen → fetch fires within seconds. Users who just wanted to
register a source for *future* collects (or just wanted to save a
configuration without hammering the API right away) had no path that
didn't trigger the auto-fetch.

Adds a "Save (don't fetch yet)" button between Cancel and Run. Same
checkbox state, same aggressive flag, but no navigation to `#/collect/…`
so collect.js doesn't auto-fire `startCollect`. The selection is also
persisted per-topic in localStorage so the next picker open restores it
— before this change, only the global "last_sources" was remembered, so
opening the picker on a different topic could silently overwrite the
saved selection of the topic the user originally tweaked.

## Changes

- **`app-tauri/src/screens/topic.js`** — `openSourcePickerModal(topic)`:
  - New `_persistPickerSelection()` helper extracted from the inline
    block in `#src-pick-go`. Writes the same three localStorage keys
    (`last_aggressive`, `last_sources`, `last_skip_reddit`) AND a new
    per-topic key `gapmap.topic.sources.${topic}` with `{checked,
    aggressive, ts}`. Returns null when nothing is checked.
  - New `#src-pick-save` button between Cancel and Run. On click: calls
    `_persistPickerSelection`, closes the modal, fires a toast confirming
    the save count. No navigation, no fetch.
  - Picker open now reads `gapmap.topic.sources.${topic}` first; if
    present, uses that as the initial checked-set (still unioned with
    detected existing sources so a prior collect's contributions don't
    drop). Saved aggressive flag also restores.
  - `#src-pick-go` refactored to call the shared helper instead of
    duplicating the localStorage writes; the navigate-to-collect step
    is now the only thing that path adds on top of Save.

## Files Modified

- `app-tauri/src/screens/topic.js` — picker save button + per-topic
  preference persistence + restore-on-open

## Files Created

- `changelogs/2026-04-30_01_source-picker-save-without-fetching.md`

## Verification

`node --check app-tauri/src/screens/topic.js` → clean.

UX walkthrough (manual):
1. Open a topic, click rerun → picker opens.
2. Tick a new source (e.g. `producthunt`).
3. Click "Save (don't fetch yet)" → modal closes, toast says
   "Saved N source(s) for "<topic>". No fetch fired." Topic screen
   stays put — no collect screen, no auto-fetch.
4. Reopen the picker — `producthunt` is still ticked.
5. Click Run when actually ready to collect — fetch fires with the
   saved source set + aggressive flag.

## Out of scope

- Same "add without fetching" affordance from the workspaces / topics
  list (currently only reachable via the topic-screen rerun button).
- Surfacing the saved selection in the topic header (e.g. a chip
  reading "5 sources configured") so users know a topic has a custom
  pick without opening the picker.
