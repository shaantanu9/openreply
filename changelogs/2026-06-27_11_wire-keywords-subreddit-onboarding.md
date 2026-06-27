# Wire Keywords, Subreddit Intel & Onboarding (live)

**Date:** 2026-06-27
**Type:** Feature

## Summary

Added two Rust commands (`agent_update`, `reply_rules`) and wired three more screens to
live data, bringing OpenReply to 13/15 screens functional.

## Changes
- Rust: `agent_update` (edit agent voice/keywords/platforms) + `reply_rules` (fetch a
  subreddit's `about/rules.json`); registered in `main.rs`. `cargo check` clean.
- JS: `api.agentUpdate`, `api.replyRules`.
- Screens (`or/dynamic.js`): **Keywords** (edit + save keywords/voice/platforms via
  `agent_update`), **Subreddit Intel** (fetch live rules via `reply_rules`), **Onboarding**
  (create first agent via `agent_create` → `#/agent`).
- `OPENREPLY_STATUS.md` updated (keywords/subreddit/onboarding → ✅ live).

## Verified
- `cargo check` clean; tauri dev rebuilt + relaunched (2m34s).
- `agent update --keywords` persists; `reply rules --sub` runs (returns empty for anon
  Reddit without a connected cookie — graceful).

## Note
Build was briefly blocked by a full disk (ENOSPC); freed by removing backup/cross-arch
binaries. `target/` debug intact (incremental builds).
