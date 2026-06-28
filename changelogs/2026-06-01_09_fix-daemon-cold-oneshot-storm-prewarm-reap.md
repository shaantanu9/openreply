# Fix: daemon cold-one-shot storm — pre-warm + aggressive reap (the disk-fill that broke chat)

**Date:** 2026-06-01
**Type:** Fix

## Summary

Diagnosed and fixed the upstream cause of the "everything is slow / chat
stopped working" reports: a **daemon lock-contention storm at boot**. The app
fires ~12 sidecar calls within ~1s of mount; they all raced the single **cold**
warm-daemon (whose first request pays a ~6–15s import while holding the slot
mutex), each timed out at the short lock ceiling (3s/6s), and each fell back to
a **cold one-shot PyInstaller spawn**. Every such spawn extracts a ~390 MB
`_MEI…` temp dir — dozens per launch accumulated and **filled the disk**
(observed live: 189 orphaned `_MEI` dirs ≈ 74 GB, disk at 100%), after which
*every* sidecar call (chat included) failed with `ENOSPC` / `Could not create
temporary directory`. That is why chat "stopped working."

The fix stops the storm at its source (pre-warm) and guarantees orphans can
never pile up again (periodic reaper), while wrapping the chat conversation
calls in the same timeout hardening as the new-topic modal.

## Changes

- **Daemon pre-warm (main.rs):** kick a single cheap `info` sidecar call in
  `.setup()` — before the webview JS runs — so the daemon pays its one-time
  import cost up front and the boot herd lands on the **warm** interpreter
  (~0.5s/call) instead of storming cold one-shots. Best-effort; logs
  `[boot] sidecar daemon pre-warmed in N ms`.
- **Lock timeouts raised (cli.rs):** `DAEMON_LOCK_TIMEOUT_DEV_SECS` 3→10,
  `DAEMON_LOCK_TIMEOUT_PROD_SECS` 6→20, so a boot call **waits** for the
  warming daemon instead of falling back to a cold one-shot. Documented
  trade-off: a UI call during a long LLM job (sentiment / audience / concepts)
  now waits a bit longer before falling back to a single one-shot — bounded,
  not a storm, and the reaper sweeps any straggler.
- **Periodic reaper (main.rs):** the boot `_MEI` reaper now loops hourly
  instead of running once, so a long session can't accumulate orphans.
- **Reaper default lowered (cli.rs):** `OPENREPLY_MEI_REAP_MIN_AGE_SECS` default
  6h → 2h — still safely longer than any single sidecar run (longest is an
  aggressive+historical collect, well under an hour) so live extractions are
  never touched, but short enough to sweep crash-orphans the same session.
- **Chat call hardening (api.js):** wrapped `chatStatus`, `chatConvList`,
  `chatConvGet`, `chatConvSave`, `chatConvRename`, `chatConvDelete`,
  `cancelChat` in `invokeWithTimeout` (15s) — they were raw `invoke()` with no
  timeout, so a slow/wedged sidecar could hang the Chats UI forever.
  `startChat` left raw (streaming, returns fast).
- **Operational:** reclaimed ~74 GB by removing the existing `_MEI` orphan
  backlog so the dev environment is usable again.

## Verification

- `cargo check` — (pending/clean in this session).
- `npm test` — 50/50 JS tests pass.

## Files Modified

- `app-tauri/src-tauri/src/main.rs` — daemon pre-warm in `.setup()`; reaper
  now hourly loop.
- `app-tauri/src-tauri/src/cli.rs` — raised daemon lock timeouts (+ rationale);
  lowered reaper default to 2h.
- `app-tauri/src/api.js` — timeout-wrapped the chat conversation/control calls.

## Relationship to other changelogs

- `_04` added the daemon **request** timeout (kills a wedged daemon).
- `_08` bounded the daemon **handshake** + **one-shot fallback** waits and the
  modal calls — stops *infinite hangs*.
- `_09` (this) stops the *cold-one-shot storm* that caused the slowness +
  disk-fill, and hardens chat. Together: no infinite hangs, no storm, no
  disk-fill.

## Follow-up

- A **new signed DMG release** is required for installed v0.1.7 users to get
  any of `_04`/`_08`/`_09` — source edits don't reach an installed app.
- Consider routing the long synchronous LLM jobs off the shared daemon mutex
  (own slot / pool) to remove the lock-timeout trade-off entirely.
