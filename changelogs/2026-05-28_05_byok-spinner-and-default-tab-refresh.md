# BYOK: spinners on Test/Save + Default Provider tab auto-refreshes

**Date:** 2026-05-28
**Type:** Fix · UI

## Summary

Three small but user-visible bugs in the BYOK (Bring Your Own Key) modal:

1. **Test button looked frozen** — just changed text to "testing…" with
   no visible spinner. Cloud LLM pings are 1-7s; the user couldn't tell
   the click registered.
2. **Save button same issue** — text-only state change.
3. **Default Provider tab went stale after save** — the dropdown
   options (which show `(ready)` or `(key missing)` per provider) were
   rendered ONCE from the initial status snapshot. Saving a fresh key
   in the LLM tab left the Default tab showing the OLD `(key missing)`
   label until the user closed and reopened the entire modal.

## Changes

### `app-tauri/src/screens/byok.js`

- Test button: replaced text-only "testing…" with
  `<span class="spinner-inline"></span>testing…`. Result line now also
  shows a `mcp-spinner` ring inline with "pinging LLM…" while waiting.
- Save button: same spinner pattern during the byokSet round-trip.
- New helper `refreshDefaultProviderOptions(latestSt)` rebuilds the
  `#byok-provider-sel` options from a fresh `byokStatus()` result.
  Preserves the user's current selection. Called from BOTH the Save
  and Clear handlers in the LLM-key rows so the Default tab reflects
  reality immediately.

### Net effect

- Click Test → spinner spins, status pill says "pinging LLM…" with a
  spinner ring next to it; on completion shows the real reply or error.
- Click Save → spinner spins, badge flips to ✓ saved, AND the Default
  Provider dropdown immediately upgrades the provider's label from
  `(key missing)` → `(ready)` without needing to close the modal.

## Files Modified

- `app-tauri/src/screens/byok.js` — Test + Save spinners, new
  `refreshDefaultProviderOptions()` helper, call it from save / clear.
