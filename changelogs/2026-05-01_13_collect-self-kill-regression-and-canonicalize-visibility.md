# Collect: stop self-killing on every run + show canonicalize wait

**Date:** 2026-05-01
**Type:** Fix (regression) + UX

## Summary

Every collect was killing itself within ~8 s of starting. Symptoms: a
`× collect exited with code -1 [unknown]` failure with only one or two
log lines (`started collect…` / `discovering subs…`) and the
elapsed-time counter stuck ticking up to a minute or two before the
failure modal landed. Caused by a race between `run_collect_inner` and
`run_cli_streaming`, made aggressively visible by the orphan sweeper
shipped in `2026-05-01_12`.

Plus three companion fixes: visible progress around the LLM canonicalize
call (the "frozen for 1 min" perception), a real `cancelled` exit class
so user-Cancel doesn't read as `[unknown]` failure, and a stalled-state
phase card so the orange "Extracting insights…" banner stops pulsing
after a failure.

## Root cause

`run_cli_streaming` is fire-and-forget — it spawns the streaming task
and returns `Ok(())` as soon as the child process is alive, NOT when
the sidecar finishes. The previous `run_collect_inner` did:

```rust
let stream_result = run_cli_streaming(...).await;  // returns instantly
app.unlisten(unlisten);                            // unregisters listener
map.remove(&topic);                                // removes from ActiveCollects
drain_collect_queue(&app);
```

That left `ActiveJob` slot HELD (sidecar still alive) but `ActiveCollects`
EMPTY for the entire lifetime of every collect — exactly the orphan
state the busy modal was already surfacing as "(orphan sidecar — name
unavailable)" when starting a second collect during the first.

The `2026-05-01_12` sweeper interpreted that state as "kill this dead
process" and SIGTERM'd the very-much-alive Python every 8 s. The
Tauri-side `Terminated` event then arrived with `code: None` →
`unwrap_or(-1)` → no classifier keyword matched → `[unknown]`.

This was a latent bug that had been present since the queue work in
`2026-04-30_01`; the sweeper turned it from "second-collect modal lies"
into "first-collect dies".

## Fixes

### 1. Stop killing every collect

`commands.rs::run_collect_inner` now uses `app.once_any("collect:done", …)`
to perform the `ActiveCollects` removal + queue drain when the sidecar
ACTUALLY terminates, not when `run_cli_streaming` returns. `once_any`
auto-unregisters after first fire so it doesn't leak. The synchronous
fallback only runs when `run_cli_streaming` itself fails (spawn error /
slot already held), since in that case `collect:done` will never fire.

### 2. Defensive sweeper

`main.rs` sweeper bumped from 8 s → 20 s and now requires two
consecutive observations of the orphan condition before reaping. Even
with the root-cause fix, the queue-drain transition has a brief window
where the map is empty + slot is empty (no real orphan) and a brief
window where the slot is empty + map has the next topic. The two-tick
guard removes any chance of a false positive killing a legitimate
collect.

### 3. Loud vs silent kills

Added `cli::cancel_active_job_silent` — same as the existing
`cancel_active_job` but does NOT set the cancel marker. Used from the
sweeper, the `start_collect` orphan-reap, the manual Unstick command,
and the app-shutdown handler — all maintenance kills where labelling
the next collect's exit "cancelled by user" would be misleading. The
loud variant stays for the `cancel_collect` command and the
`cancel_and_start` busy policy, both genuinely user-driven.

### 4. Cancelled vs unknown

Added `CollectCancelMarker` managed state. `cancel_active_job` (loud)
sets it. The streaming `Terminated` handler (both prod and dev paths)
calls `take_cancel_marker` and overrides the classifier to
`("cancelled", "Cancelled by user. Partial results are kept.")` when
the flag is set + exit code is non-zero. The marker auto-resets after
the next done event so future failures aren't mislabelled.

### 5. Canonicalize visibility

`collect.py` emits a progress line before and after the LLM
canonicalize call:

```text
canonicalizing topic via LLM (first run may take ~30-60s on cold model)…
  → canonical: "meditation and sound frequency brainwave app" (confidence: high, no rewrite)
```

This used to be silent — on a cold Ollama model the user would stare
at "discovering subs for …" for up to a minute thinking the app had
hung. Now they can see exactly what the wait is for.

### 6. Phase card stops shouting after a failure

When `collect:done` arrives with non-zero `code`, `screens/collect.js`
adds a `phase-stalled` class to the phase card. New CSS in `style.css`
neutralizes the orange border + box-shadow + animation and softens the
fill bar to ink-3. The "Extracting insights…" copy is no longer
visually loud while the user is reading a failure message.

### 7. Cancel button log line

The `× collect exited with code -1 [unknown]` red-on-red log line is
gone for cancellations. Instead the user sees:

```text
■ cancelled by user
  Cancelled by user. Partial results are kept.
```

…with the status pill flipping to "cancelled" (fading-grey) instead of
"failed" (red).

## Files Created

- `changelogs/2026-05-01_13_collect-self-kill-regression-and-canonicalize-visibility.md`

## Files Modified

- `app-tauri/src-tauri/src/cli.rs` — new `CollectCancelMarker`,
  `take_cancel_marker`, `cancel_active_job_silent`. `cancel_active_job`
  now sets the marker. Both Terminated handlers (prod + dev) consult the
  marker before classifying.
- `app-tauri/src-tauri/src/commands.rs` — `run_collect_inner` rewritten
  to use `once_any` listener for ActiveCollects cleanup. Orphan reap in
  `start_collect` and `clear_orphan_collect_lock` now use the silent
  variant.
- `app-tauri/src-tauri/src/main.rs` — register `CollectCancelMarker`
  managed state. Sweeper interval 8s→20s with two-tick confirmation.
  Sweeper + shutdown use `cancel_active_job_silent`.
- `src/reddit_research/research/collect.py` — emit progress lines
  around `_canonicalize_topic` so the LLM cold-start wait is legible.
- `app-tauri/src/screens/collect.js` — handle `error_class === 'cancelled'`
  with neutral styling + log line. Add `phase-stalled` class on
  non-zero exit.
- `app-tauri/src/style.css` — `.phase-card.phase-stalled` ruleset.

## Verified

- `cargo check` — clean (only the pre-existing JWT_DESKTOP_SECRET
  warning).
- `node --check` on every modified JS file — clean.
- `python -m ast` parse on `collect.py` — clean.
- IPC contract: `error_class` now includes `"cancelled"` as a possible
  value alongside `ok | reddit_rate_limit | network | llm_key |
  llm_model | db | unknown`. Frontend already had a default branch so
  unknown classes degrade gracefully on older builds.

## Why the user saw "1m 46s" before failure

Even though the sweeper killed the sidecar at ~8 s, two things stretched
the perceived elapsed:

1. The UI elapsed counter is wall-clock, started at the moment the user
   hit Start. It kept ticking until `collect:done` arrived.
2. The Python sidecar's stderr was still draining via PIPE/queue when
   SIGTERM landed. Tauri's `Terminated` event arrives only after the
   stdio pipes are fully drained — that takes longer when the child was
   in a blocking LLM call (Ollama's HTTP socket needs to error out
   before Python's exit handler runs).

Net: ~8s sweeper kill + 60-90s pipe drain + 5-10s Tauri event flush =
the ~1-2 min the user observed.

## How to verify the fix

```text
1. Start a collect on a fresh topic (e.g. "vector databases in 2026").
2. Watch the log: you should see the new line
     canonicalizing topic via LLM (first run may take ~30-60s on cold model)…
   followed within ~30s by
     → canonical: "vector databases" (confidence: high)
3. The collect should proceed past discover_subs into source fetches.
   No 8-second self-kill, no "× collect exited with code -1 [unknown]".
4. While it's running, hit Cancel.
   You should see:
     ■ cancelled by user
   …with the status pill turning grey, not red. NOT "[unknown]".
```
