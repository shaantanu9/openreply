# FSD Fleet — live token-streaming of the flow (Phase 3c)

**Date:** 2026-06-14
**Type:** Feature

## Summary

The last portable FSD-Fleet refinement: the **Run Fleet** flow now streams its
stages **live** instead of settling from the final result. As each stage
completes, it lights up in the timeline in real time (clarify → ground →
synthesize → debate → audit), with the next stage shown as running.

## How it works

- **CLI:** `research fleet-run --stream` emits sentinel-tagged NDJSON — one
  `{"__fleet":true,"event":"stage",…}` line per stage as it finishes (via the
  orchestrator's existing `on_stage` hook), then a final
  `{"__fleet":true,"event":"done","result":…}`.
- **Bridge:** Rust `fleet_run_stream` reuses `run_cli_streaming`, forwarding
  every stdout line as a `fleet:progress` event and a `fleet:done` on exit
  (shares the collect mutual-exclusion guard + cancel support).
- **Frontend:** `api.fleetRunStream` + `onFleetProgress` / `onFleetDone`.
  `fleetFlow.js` renders a pending timeline, then flips each stage from
  running → final as `fleet:progress` arrives. Parsing is **defensive** —
  `run_cli_streaming` interleaves sidecar log lines (e.g. Chroma warnings) into
  the same channel, so non-JSON / non-`__fleet` lines are ignored. A
  `fleet:done` with no preceding result line settles from `fleet-status`.

## Verification

- CLI NDJSON format confirmed (quick route, no LLM): 2 stage lines + 1 done line,
  all `__fleet`-tagged, no stray output.
- `cargo check` 0 errors · `npm run build` clean · `npm test` 52/52 ·
  `pytest test_fleet_flow.py test_debate_run.py` 11/11.
- Live event behavior (stage-by-stage UI updates) needs the running app to
  observe — verified the pipeline end to end at the CLI + compile + build levels.

## Files Modified

- `src/gapmap/cli/main.py` — `fleet-run --stream` NDJSON mode.
- `app-tauri/src-tauri/src/commands.rs` · `main.rs` — `fleet_run_stream` command.
- `app-tauri/src/api.js` — `fleetRunStream` + `onFleetProgress` / `onFleetDone`.
- `app-tauri/src/screens/fleetFlow.js` — live streaming `_run` + defensive parse.
