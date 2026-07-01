# Daily Overview — instant first paint (quick feed + deferred learn + SWR)

**Date:** 2026-07-01
**Type:** Performance

## Summary

The Daily Update (digest) panel on the Overview/agent screen blocked the first
open of each day on a single monolithic `build_digest()` call that ran four
expensive steps strictly in sequence (`collect` 5–15s → `learn` 5–10s → `rank`
1–2s → `synthesize` 2–5s ≈ 15–35s total), showing only a spinner the whole
time. Roughly half of that (`learn`) doesn't even change what the user sees —
it feeds the agent's brain, not the on-screen digest.

This change makes the panel paint near-instantly using three cooperating levers
and a small pulsing "updating…" dot that stays lit until the full background
refresh (fetch → briefing → learn) completes, so the user always knows the
latest is on its way:

1. **Instant paint (SWR):** today's cached digest paints immediately; if there's
   no today cache, yesterday's is shown as a placeholder instead of a blank
   spinner.
2. **Quick feed path:** a new read-only `quick_digest()` ranks the feed straight
   from the existing corpus (no network, no learn, no LLM) and returns in ~1–3s,
   reusing the last briefing so the briefing column isn't empty.
3. **Progressive background rebuild:** the full `build_digest` runs in the
   background with `learn` deferred to a separate fire-and-forget `agent_learn`
   pass, so the fresh feed + briefing land as soon as they're built.

Second+ opens the same day remain a <10ms cache hit. Scheduled/background daily
builds are unchanged (they still learn inline).

## Changes

- Added `quick_digest()` — instant, read-only, corpus-only feed ranking with a
  reused (stale-flagged) briefing; never persists so the full build still runs.
- Extracted `_prev_delta()` helper (yesterday's digest → exclude-ids + since_utc)
  shared by `build_digest` and `quick_digest`.
- New `reply digest-quick` CLI command.
- New `agent_digest_quick` Tauri command; `agent_digest` gained a `no_learn` flag
  (used by the UI to defer the learn pass); registered in `main.rs`.
- `api.js`: added `agentDigestQuick()`; `agentDigest(rebuild, noLearn)`.
- `dynamic.js`: rewired the digest boot sequence to SWR-instant-paint → quick
  feed → background rebuild + deferred learn; added a blinking "updating…" dot in
  the panel header; refactored `digestPaint()` to derive the spinner/dot from
  `D.updating` state (big spinner only on a truly-cold first build).

## Files Modified

- `src/openreply/reply/digest.py` — `_prev_delta()`, `quick_digest()`, refactored
  `build_digest()` delta block.
- `src/openreply/cli/reply_cmds.py` — `reply digest-quick` command.
- `app-tauri/src-tauri/src/commands.rs` — `agent_digest_quick`; `no_learn` on
  `agent_digest`.
- `app-tauri/src-tauri/src/main.rs` — registered `agent_digest_quick`.
- `app-tauri/src/or/api.js` — `agentDigestQuick`, `agentDigest` noLearn arg.
- `app-tauri/src/or/dynamic.js` — instant-paint orchestration, quick feed,
  deferred learn, blinking "updating…" indicator.
