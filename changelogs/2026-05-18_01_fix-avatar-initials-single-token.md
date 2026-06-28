# Fix: avatarInitials returns one letter for single-token names

**Date:** 2026-05-18
**Type:** Fix

## Summary

Found during a full test sweep of CLI / persona / MCP / GUI. The Tauri
frontend's `avatarInitials()` returned a single character for a one-word
name (e.g. `"Ada"` → `"A"`) while the test and the multi-word branch both
expect a two-character avatar (`"Ada"` → `"AD"`, `"Ada Lovelace"` → `"AL"`).
Single-character avatars looked inconsistent next to the two-char ones.

## Changes

- `app-tauri/src/screens/settings.js` — `avatarInitials()` single-token
  branch now returns `parts[0].slice(0, 2).toUpperCase()` instead of
  `parts[0][0].toUpperCase()`. `"Ada"` → `"AD"`, `"x"` → `"X"` (short
  names still return what they have).

## Verification

- `npm test` (Tauri frontend): **14/14 pass** (was 13/14 — `avatarInitials:
  single token → first two letters` now passes).
- `npm run build`: clean, 1773 modules, exit 0.
- `cargo check` / `cargo test` (src-tauri): 0 errors, 26 tests pass.

## Files Created

- `changelogs/2026-05-18_01_fix-avatar-initials-single-token.md`

## Files Modified

- `app-tauri/src/screens/settings.js` — two-letter single-token initials
