# Fix: new-topic modal / collect hanging — bound every unbounded sidecar wait

**Date:** 2026-06-01
**Type:** Fix

## Summary

A user on the bundled **Gap Map 0.1.7 DMG** reported that the new-topic modal
"selections are ignored," the collect "never starts," everything "takes way
too long," and a second topic started right after the first "doesn't work."
Investigation traced all four symptoms to **one root cause**: every one of
those actions funnels through a sidecar `run_cli` call, and several waits on
that path had **no timeout**. On the bundled path all `run_cli` calls
serialize through a single warm-daemon mutex, so one slow/wedged request (a
cold PyInstaller boot whose first heavy import — chromadb / onnx — stalls)
held the lock indefinitely and froze every downstream call.

Two common DMG-cascade causes were ruled out first: disk had 9.1 GB free, and
`upx=False` was already set in `gapmap-cli.spec`.

This change bounds **every** remaining unbounded sidecar wait — frontend and
backend — so a stuck sidecar self-heals instead of freezing the UI. It
extends the daemon-request-timeout fix (changelog `_04`) to the handshake and
one-shot fallback layers it left uncovered, and closes the frontend raw-invoke
gap that hung the new-topic modal's Start handler.

## Root cause → symptom map

| Symptom | Unbounded wait that caused it |
|---|---|
| "Modal selections ignored" | `api.listIntents()` for the intent/source picker never returned → picker rendered empty → defaults applied |
| "Collect never starts" | New-topic **Start** handler `await`s `findExistingTopic` + `topicIntentSet`, both **raw `invoke()` with no timeout** → hung before navigating to `#/collect` |
| "Starts but hangs / very slow" | Daemon handshake + one-shot fallback `output()` awaited with no ceiling |
| "2nd topic blocked" | Held daemon mutex + single-flight lock never freed |

## Changes

- **Frontend (api.js):** routed three interactive, should-be-fast calls
  through the existing 90s `invokeWithTimeout` helper with tighter ceilings:
  - `findExistingTopic` → 15s (modal Start awaits it; failure is non-fatal,
    collect proceeds)
  - `topicIntentSet` → 15s (same modal Start path)
  - `mcpClients` → 20s (Settings MCP card mount)
- **Backend (cli.rs):** added two constants and bounded four previously-
  unbounded `await`s:
  - `DAEMON_HANDSHAKE_TIMEOUT_SECS = 45` — wraps the `_daemon_ready`
    handshake read in **both** `spawn_dev_daemon` and `spawn_sidecar_daemon`
    (these read while holding the slot guard; a wedged cold import used to
    block forever). On timeout the child is killed and the caller falls back
    to one-shot.
  - `ONESHOT_REQUEST_TIMEOUT_SECS = 120` — wraps the one-shot fallback
    `output()` in **both** `run_dev_python_cli` and the production `run_cli`
    path (the daemon round-trip was already bounded by changelog `_04`; this
    covers the fallback layer it sits on top of).

## Verification

- `cargo check` — 0 errors (1 pre-existing JWT build-script warning).
- `npm test` — 50/50 JS tests pass.

## Files Modified

- `app-tauri/src/api.js` — timeout-wrapped `findExistingTopic`,
  `topicIntentSet`, `mcpClients`.
- `app-tauri/src-tauri/src/cli.rs` — added `DAEMON_HANDSHAKE_TIMEOUT_SECS` +
  `ONESHOT_REQUEST_TIMEOUT_SECS`; bounded both daemon handshakes and both
  one-shot fallback `output()` calls.

## Follow-up (not in this change)

- **A new signed DMG must be built + released** for installed v0.1.7 users to
  receive any of this — source edits do not reach an already-installed app.
- Cold-start latency itself (heavy first import in the bundled daemon) is a
  separate perf item; these timeouts prevent the *infinite hang*, not the
  cold-boot slowness.
- Multiple-topics-back-to-back still routes through the busy modal
  (queue / cancel-and-start) by design; revisit if the friction persists once
  the hang is gone.
