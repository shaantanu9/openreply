# Settings: group cards into labeled sections

**Date:** 2026-05-30
**Type:** UI Enhancement

## Summary

The Settings grid held ~18 cards in arbitrary author order with 5 full-width cards (`grid-column:1/-1`) scattered among half-width ones, producing ragged rows + stair-stepped gaps ("the boxes aren't proper, the sequence should be proper"). Grouped the cards into 5 labeled sections — Profile & preferences · AI & search · Data & sources · Integrations & tools · Danger zone — via CSS `order` under full-width section-label dividers, so no markup had to be physically reshuffled (lower collision risk, no dropped cards). Full-width cards get the highest order in their band so they always land at a section's end and never split a row.

## Changes

- Added 5 `.settings-section-label` divider divs (with `order:10/20/30/40/50`) at the top of the settings grid.
- Gave the 5 previously-idless cards stable IDs (`card-preferences`, `card-onboarding`, `card-danger`, `card-about`).
- Added `.settings-section-label` styling + per-card `order` rules mapping all 18 cards + profile card + error row into their section bands.

## Files Modified

- `app-tauri/src/screens/settings.js` — section-label divs + card IDs
- `app-tauri/src/style.css` — `.settings-section-label` + `#settings-grid` order rules

## Note

The "delete/clear/reset profile not working" report was verified to be the sidecar-255 cascade (those actions call the sidecar) — the command triangle for `delete_topic`, `purge_deleted_topics`, `app_reset_preview`, `app_hard_reset` is intact (commands.rs ↔ main.rs ↔ api.js) and "Reset UI state" is pure-localStorage. No wiring change needed; resolves with the upx=False sidecar fix.
