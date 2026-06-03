# Sweep: await every control-flow confirm() dialog (Tauri async dialog fix)

**Date:** 2026-06-03
**Type:** Fix

## Summary

Tauri v2 routes `window.confirm()` to the (async) dialog plugin, but the app
called `confirm()` synchronously in `if (!confirm(...))` / `const x = confirm(...)`
patterns. Because the override returns a Promise (always truthy), the guarded
action proceeded WITHOUT waiting for the user's choice — every "are you sure?"
was effectively a no-op (and, before the `dialog:allow-confirm` permission was
added in the previous commit, also threw an unhandled rejection).

This sweeps every control-flow `confirm()` / `window.confirm()` call to
`await confirm(...)`, wrapping the negated form as `if (!(await confirm(...)))`,
and makes any enclosing handler `async` where it wasn't already. Destructive
actions (delete topic/persona/model/interview/response/task, hard reset,
disconnect MCP, stop service, cancel fetch, sign out, etc.) now truly wait for
confirmation.

`alert(...)` calls were intentionally left as-is — they're fire-and-forget
notifications (their return value is never used), and the `dialog:allow-message`
permission added previously already stops them throwing.

## Changes

Converted all sync control-flow confirms to `await` across:
- `src/main.js` (2: start-topic modal, use-existing-topic)
- `src/screens/settings.js` (8: disconnect MCP, clear profile, clear prefs,
  reset UI state, purge trash, CLI uninstall, reset prompt, delete whisper model)
- `src/screens/byok.js` (3: remove key, delete model, stop Ollama)
- `src/screens/topic.js` (3: delete chat, fetch-more confirm, stop fetch)
- `src/screens/home.js`, `collect.js`, `ost.js`, `personas.js`, `interviews.js`,
  `estimate.js`, `pmf.js`, `welcome.js` (1 each)

Handlers made `async` where needed: collect.js clear-log, settings.js
disconnect/clear-profile/clear-prefs/reset-ui-state, topic.js fetch-more.

## Verification

- `node --check` on all 12 changed files: pass (catches `await` in non-async fns)
- Global grep for `if (!confirm(` / `= confirm(` (sync) across `src`: **zero left**
- JS test suite (`npm test`): 50/50 pass
- App hot-reloaded the changes under `tauri dev`

## Files Modified

- `app-tauri/src/main.js`
- `app-tauri/src/screens/{settings,byok,topic,home,collect,ost,personas,interviews,estimate,pmf,welcome}.js`

## Files Created

- `changelogs/2026-06-03_03_await-all-confirm-dialogs.md`
